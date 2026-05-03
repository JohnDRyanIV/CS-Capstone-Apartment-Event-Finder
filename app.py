from flask import (
    Flask, render_template, make_response,
    jsonify, Response, redirect, abort
)
from flask_restful import Api, request, Resource
from flask_bcrypt import Bcrypt
from datetime import datetime
from dotenv import load_dotenv

from azure.storage.blob import BlobServiceClient

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

import pyodbc
import os
import hmac
import hashlib


# Constants
MAX_USERNAME_LENGTH = 50
MIN_PASSWORD_LENGTH = 8
SESSION_EXPIRY_SECONDS = 60 * 60 * 24 * 7
BAD_LOGIN_MESSAGE = "Invalid Username or Password, try again."

# Load environment variables if we're in development.
# Azure will always set the "WEBSITE_HOSTNAME" environment variable when running,
# so we can use its presence to determine if we are on Azure.
if "WEBSITE_HOSTNAME" not in os.environ:
    load_dotenv(".secret.env")

# Load config from environment
CONNECTION_STRING = os.environ["AZURE_SQL_CONNECTIONSTRING"]
APP_SECRET        = os.environ["FLASK_SECRET_KEY"]
MAPBOX_TOKEN      = os.environ["MAPBOX_TOKEN"]
blob_service      = BlobServiceClient.from_connection_string(
    os.environ["AZURE_STORAGE_CONNECTION_STRING"]
)

# Initialize Flask
app = Flask(
    __name__,
    template_folder="public",
    static_folder=".",
    static_url_path=""
)

flask_bcrypt = Bcrypt(app)
api          = Api(app)


# ── Helpers ────────────────────────────────────────────────────────────────────

def addResource(route: str):
    """Decorator: registers a Resource class at the given route."""
    def wrapper(cls, *args, **kwargs):
        api.add_resource(cls, route, *args, **kwargs)
        return cls
    return wrapper

def require_login(fn):
    """Decorator: aborts with 401 if the request has no valid session."""
    def wrapper(*args, **kwargs):
        session_id = request.cookies.get("session_id")
        if not session_id:
            abort(401)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT 1 FROM Sessions WHERE sessionid = ? AND expiry > GETDATE()",
                (session_id,)
            )
            if not cursor.fetchone():
                abort(401)
        return fn(*args, **kwargs)
    return wrapper


# ── Database ───────────────────────────────────────────────────────────────────

class DatabaseWakingUpError(Exception):
    pass

_db_executor = ThreadPoolExecutor(max_workers=10)

def get_db_connection(timeout=3):
    """Connect to the database in a thread pool so Flask's main thread is never blocked
    (or else it hangs the entire application until ODBC finishes, ANNOYING! >:( ))."""
    future = _db_executor.submit(pyodbc.connect, CONNECTION_STRING)
    try:
        return future.result(timeout=timeout)
    except FuturesTimeoutError:
        future.cancel()
        raise DatabaseWakingUpError()
    except pyodbc.Error as e:
        if "40613" in str(e) or "HYT00" in str(e):
            raise DatabaseWakingUpError()
        raise

@app.errorhandler(DatabaseWakingUpError)
def handle_waking_up(e):
    return {"message": "Database is waking up. Try again soon."}, 503


# ── Auth utilities ─────────────────────────────────────────────────────────────

def sign_session_cookie(session_id: str) -> str:
    signature = hmac.new(
        APP_SECRET.encode(), session_id.encode(), hashlib.sha256
    ).hexdigest()
    return f"{session_id}:{signature}"

def verify_session_cookie_signature(cookie: str) -> str | None:
    try:
        session_id, signature = cookie.split(":")
        expected_signature = hmac.new(
            APP_SECRET.encode(), session_id.encode(), hashlib.sha256
        ).hexdigest()
        if hmac.compare_digest(signature, expected_signature):
            return session_id
    except (ValueError, AttributeError):
        pass
    return None

def delete_session(session_id: str, cursor: pyodbc.Cursor) -> bool:
    try:
        cursor.execute("DELETE FROM Sessions WHERE sessionid = ?", (session_id,))
    except pyodbc.Error:
        return False
    return True

def validate_username(username: str, db_cursor: pyodbc.Cursor) -> tuple[bool, str]:
    if not username.isalnum():
        return False, "Username must be alphanumeric"
    elif len(username) > MAX_USERNAME_LENGTH:
        return False, "Username must be at most 20 characters long"
    elif db_cursor.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone():
        return False, "Username already exists"
    return True, ""

def validate_password(password: str) -> tuple[bool, str]:
    if len(password) < MIN_PASSWORD_LENGTH:
        return False, f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
    return True, ""

def update_login_time(conn, username):
    try:
        conn.cursor().execute(
            "UPDATE Users SET last_login = ? WHERE username = ?",
            (datetime.now(), username),
        )
    except pyodbc.Error:
        return False
    return True

def create_session(username: str, cursor: pyodbc.Cursor) -> str:
    session_id = cursor.execute(
        """INSERT INTO Sessions (sessionid, userid, expiry)
           OUTPUT INSERTED.sessionid
           VALUES (
               NEWID(),
               (SELECT userid FROM Users WHERE username = ?),
               DATEADD(WEEK, 1, GETDATE())
           );""",
        (username,),
    ).fetchone()
    return session_id[0]

def get_user_from_session(cookie):
    """Returns the user row, 'expired', or None."""
    session_id = verify_session_cookie_signature(cookie)
    if session_id is None:
        return None

    with get_db_connection() as conn:
        cursor = conn.cursor()

        session = cursor.execute(
            "SELECT userid, expiry FROM Sessions WHERE sessionid = ?", (session_id,)
        ).fetchone()

        if session is None:
            return None

        if datetime.now() > session.expiry:
            cursor.execute("DELETE FROM Sessions WHERE sessionid = ?", (*session_id,))
            conn.commit
            return "expired"

        user = cursor.execute(
            """SELECT display_name, last_login FROM Users
               WHERE userid = (SELECT userid FROM Sessions WHERE sessionid = ?)""",
            (session_id,),
        ).fetchone()
        cursor.close()
    return user

def get_template_context():
    """Never hits the DB — frontend checks auth status asynchronously."""
    cookie = request.cookies.get("sessionID")
    return {"is_logged_in": bool(cookie)}


# ── Resources ──────────────────────────────────────────────────────────────────

@addResource("/register")
class Register(Resource):
    def post(self):
        data = request.get_json()

        for key in ["username", "password", "displayName"]:
            if key not in data:
                return {"message": f"Missing required field: {key}"}, 400

        username     = data.get("username")
        password     = data.get("password")
        display_name = data.get("displayName")

        success, message = validate_password(password)
        if not success:
            return {"message": message}, 400

        if not display_name:
            return {"message": "Display name cannot be empty"}, 400

        with get_db_connection() as conn:
            cursor = conn.cursor()

            success, message = validate_username(username, cursor)
            if not success:
                return {"message": message}, 400

            hashed_password = flask_bcrypt.generate_password_hash(password).decode("utf-8")

            try:
                cursor.execute(
                    "INSERT INTO Users (username, password, display_name) VALUES (?, ?, ?)",
                    (username, hashed_password, display_name),
                )
                cursor.commit()
            except pyodbc.Error:
                return {"message": "An error occurred while creating the user"}, 500
            finally:
                cursor.close()

            return {"message": "User created successfully", "displayName": display_name}, 201


@addResource("/login")
class Login(Resource):
    def post(self):
        data     = request.get_json()
        username = data.get("username")
        password = data.get("password")

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                user = cursor.execute(
                    "SELECT * FROM Users WHERE username = ?", (username,)
                ).fetchone()
            except pyodbc.Error:
                return {"message": "An internal error has occurred"}, 500

            if user is None or not flask_bcrypt.check_password_hash(user.password, password):
                return {"message": BAD_LOGIN_MESSAGE}, 400

            update_login_time(conn, username)

            session_id    = create_session(username, cursor)
            session_cookie = sign_session_cookie(session_id)

            cursor.commit()
            cursor.close()

            response = make_response(
                {
                    "displayName": user.display_name,
                    "lastLogin": (user.last_login or user.create_date).isoformat(),
                },
                200,
            )
            response.set_cookie(
                "sessionID",
                samesite="Strict",
                value=session_cookie,
                max_age=SESSION_EXPIRY_SECONDS,
            )
            return response


@addResource("/logout")
class Logout(Resource):
    def post(self):
        session_cookie = request.cookies.get("sessionID")
        if not session_cookie:
            return {"message": "Not logged in"}, 400

        session_id = verify_session_cookie_signature(session_cookie)
        if session_id is None:
            return {"message": "Invalid session"}, 400

        with get_db_connection() as conn:
            cursor = conn.cursor()
            delete_session(session_id, cursor)
            cursor.commit()
            cursor.close()

        response = make_response({"message": "Successfully logged out."}, 200)
        response.set_cookie("sessionID", value="", expires=0, samesite="Strict")
        return response


@addResource("/auth")
class AuthEndpoint(Resource):
    def get(self):
        user = get_user_from_session(request.cookies.get("sessionID"))
        if user is None:
            return {"message": "Not authenticated"}, 401
        elif user == "expired":
            response = make_response({"message": "Session expired. Please log in again."}, 401)
            response.delete_cookie("sessionID")
            return response
        return make_response(
            render_template("auth.html", name=user.display_name, show_logout_button=True)
        )


@addResource("/api/favorites")
class Favorites(Resource):
    def get(self):
        user = get_user_from_session(request.cookies.get("sessionID"))
        if user is None:
            return {"message": "Not authenticated"}, 401
        elif user == "expired":
            return {"message": "Session expired. Please log in again."}, 401

        session_id = verify_session_cookie_signature(request.cookies.get("sessionID"))

        with get_db_connection() as conn:
            cursor = conn.cursor()
            rows = cursor.execute(
                """SELECT item_id, item_type, created_at
                   FROM Favorites
                   WHERE userid = (SELECT userid FROM Sessions WHERE sessionid = ?)""",
                (session_id,)
            ).fetchall()
            cursor.close()

        favorites = [
            {"item_id": row.item_id, "item_type": row.item_type, "created_at": row.created_at.isoformat()}
            for row in rows
        ]
        return {"favorites": favorites}, 200

    def post(self):
        user = get_user_from_session(request.cookies.get("sessionID"))
        if user is None:
            return {"message": "Not authenticated"}, 401
        elif user == "expired":
            return {"message": "Session expired. Please log in again."}, 401

        data      = request.get_json()
        item_id   = data.get("item_id")
        item_type = data.get("item_type")

        if not item_id or not item_type:
            return {"message": "Missing item_id or item_type"}, 400
        if item_type not in ("apartment", "event"):
            return {"message": "item_type must be 'apartment' or 'event'"}, 400

        session_id = verify_session_cookie_signature(request.cookies.get("sessionID"))

        with get_db_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    """INSERT INTO Favorites (userid, item_id, item_type, created_at)
                       VALUES (
                           (SELECT userid FROM Sessions WHERE sessionid = ?),
                           ?, ?, ?
                       )""",
                    (session_id, item_id, item_type, datetime.now())
                )
                cursor.commit()
            except pyodbc.Error as e:
                if "UQ_Favorite" in str(e) or "2627" in str(e) or "2601" in str(e):
                    return {"message": "Already in favorites"}, 409
                return {"message": "An error occurred"}, 500
            finally:
                cursor.close()

        return {"message": "Added to favorites"}, 201

    def delete(self):
        user = get_user_from_session(request.cookies.get("sessionID"))
        if user is None:
            return {"message": "Not authenticated"}, 401
        elif user == "expired":
            return {"message": "Session expired. Please log in again."}, 401

        data      = request.get_json()
        item_id   = data.get("item_id")
        item_type = data.get("item_type")

        if not item_id or not item_type:
            return {"message": "Missing item_id or item_type"}, 400

        session_id = verify_session_cookie_signature(request.cookies.get("sessionID"))

        with get_db_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    """DELETE FROM Favorites
                       WHERE userid = (SELECT userid FROM Sessions WHERE sessionid = ?)
                       AND item_id = ? AND item_type = ?""",
                    (session_id, item_id, item_type)
                )
                cursor.commit()
            except pyodbc.Error:
                return {"message": "An error occurred"}, 500
            finally:
                cursor.close()

        return {"message": "Removed from favorites"}, 200


# ── Page routes ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", **get_template_context())

@app.route("/data/apartments")
def apartments():
    try:
        blob_client = blob_service.get_blob_client(container="jsons", blob="apartments.json")
        data = blob_client.download_blob().readall()
        return Response(data, mimetype="application/json")
    except Exception as e:
        print(e)
        return Response(str(e), status=500)

@app.route("/data/events")
def events():
    blob_client = blob_service.get_blob_client(container="jsons", blob="catchdesmoines-events.json")
    data = blob_client.download_blob().readall()
    return Response(data, mimetype="application/json")

@app.route("/map")
def map_page():
    ctx = get_template_context()
    return render_template("maps.html", mapbox_token=MAPBOX_TOKEN, **ctx)

@app.route("/signin")
def signin_form():
    return render_template("signin.html", **get_template_context())

@app.route("/favorites")
def favorites_page():
    ctx = get_template_context()
    if not ctx["is_logged_in"]:
        return redirect("/signin")
    return render_template("favorites.html", **ctx)


if __name__ == "__main__":
    app.run(debug=True)