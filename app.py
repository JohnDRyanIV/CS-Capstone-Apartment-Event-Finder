from flask import (
    Flask, render_template, make_response,
    jsonify, Response, redirect, abort
)
from flask_restful import Api, request, Resource
from flask_bcrypt import Bcrypt
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from collections import namedtuple
from threading import Lock

import requests
import oracledb
import os
import uuid
import hmac
import hashlib


# Constants
MAX_USERNAME_LENGTH = 50
MIN_PASSWORD_LENGTH = 8
SESSION_EXPIRY_SECONDS = 60 * 60 * 24 * 7
BAD_LOGIN_MESSAGE = "Invalid Username or Password, try again."
OBJECT_CACHE_TTL = timedelta(minutes=10)

# Load environment variables if we're in development.
# On the OCI compute instance, set OCI_DEPLOYMENT=1 in the systemd unit file.
# (Replaces the old WEBSITE_HOSTNAME check, which was Azure-specific.)
if "OCI_DEPLOYMENT" not in os.environ:
    load_dotenv(".secret.env")

# Load config from environment
#
# ORACLE_DB_DSN is the full TLS connection string copied from
# Database connection -> TLS authentication: TLS. It's a long
# "(description=(retry_count=20)...)" blob — paste it whole, in quotes.
DB_USER     = os.environ.get("ORACLE_DB_USER", "ADMIN")
DB_PASSWORD = os.environ["ORACLE_DB_PASSWORD"]
DB_DSN      = os.environ["ORACLE_DB_DSN"]

APP_SECRET   = os.environ["FLASK_SECRET_KEY"]
MAPBOX_TOKEN = os.environ["MAPBOX_TOKEN"]

# Base URL for the Object Storage bucket. Either the public bucket URL or a
# Pre-Authenticated Request URL — the app doesn't care which, it just does an
# HTTP GET. No SDK, no signing keys, no ~/.oci directory.
#   Public:  https://objectstorage.<region>.oraclecloud.com/n/<ns>/b/<bucket>/o
#   PAR:     https://objectstorage.<region>.oraclecloud.com/p/<token>/n/<ns>/b/<bucket>/o
JSON_BASE_URL = os.environ["OCI_JSON_BASE_URL"].rstrip("/")

# Initialize Flask
app = Flask(
    __name__,
    template_folder="public",
    static_folder=".",
    static_url_path=""
)

flask_bcrypt = Bcrypt(app)
api          = Api(app)


# ── Object Storage (replaces Azure Blob Storage) ───────────────────────────────

_object_cache = {}
_object_cache_lock = Lock()


def fetch_object(name: str, use_cache: bool = True) -> bytes:
    """GET an object from the bucket over plain HTTPS.

    Short in-process cache because the scrapers only rewrite these files a few
    times a day — re-downloading multi-MB JSON on every page load is wasted
    latency. Cache is per worker process, so each Gunicorn worker holds a copy.
    """
    now = datetime.now(timezone.utc)

    if use_cache:
        with _object_cache_lock:
            cached = _object_cache.get(name)
            if cached and now - cached[0] < OBJECT_CACHE_TTL:
                return cached[1]

    response = requests.get(f"{JSON_BASE_URL}/{name}", timeout=10)
    response.raise_for_status()
    data = response.content

    if use_cache:
        with _object_cache_lock:
            _object_cache[name] = (now, data)

    return data


# ── Helpers ────────────────────────────────────────────────────────────────────

def addResource(route: str):
    """Decorator: registers a Resource class at the given route."""
    def wrapper(cls, *args, **kwargs):
        api.add_resource(cls, route, *args, **kwargs)
        return cls
    return wrapper


def utcnow() -> datetime:
    """Naive UTC timestamp.

    Autonomous Database runs in UTC, so SYSTIMESTAMP and this agree. Keeping
    everything naive-UTC avoids "can't compare offset-naive and offset-aware
    datetimes" when comparing against TIMESTAMP columns.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def as_objects(cursor):
    """Give rows attribute access, like pyodbc.Row did.

    python-oracledb returns plain tuples, but this codebase uses user.password,
    session.expiry, row.item_id, etc. Oracle also uppercases unquoted column
    names, so field names are lowercased here to keep those attribute names
    working unchanged. Must be called AFTER cursor.execute().
    """
    Row = namedtuple("Row", [d[0].lower() for d in cursor.description])
    cursor.rowfactory = lambda *args: Row(*args)
    return cursor


def query(cursor, sql: str, params: dict | None = None):
    """Execute a SELECT and enable attribute access on the results."""
    cursor.execute(sql, params or {})
    return as_objects(cursor)


def require_login(fn):
    """Decorator: aborts with 401 if the request has no valid session."""
    def wrapper(*args, **kwargs):
        # NOTE: reads "session_id" but the rest of the app sets "sessionID".
        # Left as-is because this decorator is currently unused — fix the
        # cookie name before applying it to any route.
        session_id = request.cookies.get("session_id")
        if not session_id:
            abort(401)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT 1 FROM sessions WHERE sessionid = :sid AND expiry > SYSTIMESTAMP",
                {"sid": session_id}
            )
            if not cursor.fetchone():
                abort(401)
        return fn(*args, **kwargs)
    return wrapper


# ── Database ───────────────────────────────────────────────────────────────────

class DatabaseWakingUpError(Exception):
    pass


_pool = None
_pool_lock = Lock()


def _build_pool():
    return oracledb.create_pool(
        user=DB_USER,
        password=DB_PASSWORD,
        dsn=DB_DSN,
        config_dir=os.environ["ORACLE_WALLET_DIR"],
        wallet_location=os.environ["ORACLE_WALLET_DIR"],
        wallet_password=os.environ["ORACLE_WALLET_PASSWORD"],
        min=1,
        max=4,
        increment=1,
        getmode=oracledb.POOL_GETMODE_TIMEDWAIT,
        wait_timeout=3000,
        ping_interval=60,
    )


def _is_database_asleep(exc: Exception) -> bool:
    """Detect a stopped or still-starting Autonomous Database.

    Always Free ATP stops itself after 7 days of inactivity — the Oracle
    equivalent of the Azure SQL serverless cold start that the frontend's
    handle503/showDbToast already knows how to display.
    """
    text = str(exc)
    return any(code in text for code in (
        "ORA-01033",   # instance startup or shutdown in progress
        "ORA-01034",   # ORACLE not available
        "ORA-12514",   # listener does not currently know of service
        "ORA-12528",   # all appropriate instances are blocking new connections
        "ORA-12541",   # no listener
        "DPY-6005",    # cannot connect to database
        "DPY-4011",    # the database or network closed the connection
    ))


def get_db_connection():
    """Acquire a pooled connection.

    The pool is built lazily so the app still boots while the database is
    stopped — otherwise a sleeping ATP instance would crash Gunicorn at import
    time and every route would 502 instead of returning a friendly 503.
    """
    global _pool
    try:
        if _pool is None:
            with _pool_lock:
                if _pool is None:
                    _pool = _build_pool()
        return _pool.acquire()
    except oracledb.Error as e:
        if _is_database_asleep(e):
            with _pool_lock:
                _pool = None       # force a rebuild on the next attempt
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


def delete_session(session_id: str, cursor) -> bool:
    try:
        cursor.execute(
            "DELETE FROM sessions WHERE sessionid = :sid", {"sid": session_id}
        )
    except oracledb.Error:
        return False
    return True


def validate_username(username: str, db_cursor) -> tuple[bool, str]:
    if not username.isalnum():
        return False, "Username must be alphanumeric"
    elif len(username) > MAX_USERNAME_LENGTH:
        return False, f"Username must be at most {MAX_USERNAME_LENGTH} characters long"

    db_cursor.execute("SELECT 1 FROM users WHERE username = :u", {"u": username})
    if db_cursor.fetchone():
        return False, "Username already exists"
    return True, ""


def validate_password(password: str) -> tuple[bool, str]:
    if len(password) < MIN_PASSWORD_LENGTH:
        return False, f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
    return True, ""


def update_login_time(conn, username):
    try:
        conn.cursor().execute(
            "UPDATE users SET last_login = :ts WHERE username = :u",
            {"ts": utcnow(), "u": username},
        )
    except oracledb.Error:
        return False
    return True


def create_session(username: str, cursor) -> str:
    """Create a session row and return its id.

    Oracle has no OUTPUT clause, and SYS_GUID() returns RAW(16) which would need
    hex encoding to survive a cookie round-trip. Generating the UUID in Python
    sidesteps both and needs no RETURNING clause.
    """
    session_id = str(uuid.uuid4())
    cursor.execute(
        """INSERT INTO sessions (sessionid, userid, expiry)
           VALUES (
               :sid,
               (SELECT userid FROM users WHERE username = :u),
               :expiry
           )""",
        {
            "sid": session_id,
            "u": username,
            "expiry": utcnow() + timedelta(seconds=SESSION_EXPIRY_SECONDS),
        },
    )
    return session_id


def get_user_from_session(cookie):
    """Returns the user row, 'expired', or None."""
    session_id = verify_session_cookie_signature(cookie)
    if session_id is None:
        return None

    with get_db_connection() as conn:
        cursor = conn.cursor()

        query(
            cursor,
            "SELECT userid, expiry FROM sessions WHERE sessionid = :sid",
            {"sid": session_id},
        )
        session = cursor.fetchone()

        if session is None:
            return None

        if utcnow() > session.expiry:
            cursor.execute(
                "DELETE FROM sessions WHERE sessionid = :sid", {"sid": session_id}
            )
            conn.commit()
            return "expired"

        query(
            cursor,
            "SELECT last_login, create_date FROM users WHERE userid = :user_id",
            {"user_id": session.userid},
        )
        user = cursor.fetchone()
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

        for key in ["username", "password"]:
            if key not in data:
                return {"message": f"Missing required field: {key}"}, 400

        username = data.get("username")
        password = data.get("password")

        success, message = validate_password(password)
        if not success:
            return {"message": message}, 400

        with get_db_connection() as conn:
            cursor = conn.cursor()

            success, message = validate_username(username, cursor)
            if not success:
                return {"message": message}, 400

            hashed_password = flask_bcrypt.generate_password_hash(password).decode("utf-8")

            try:
                cursor.execute(
                    "INSERT INTO users (username, password) VALUES (:u, :p)",
                    {"u": username, "p": hashed_password},
                )
                conn.commit()
            except oracledb.IntegrityError:
                # Lost the race against a concurrent signup with the same name.
                return {"message": "Username already exists"}, 409
            except oracledb.Error:
                return {"message": "An error occurred while creating the user"}, 500
            finally:
                cursor.close()

            return {"message": "User created successfully", "displayName": username}, 201


@addResource("/login")
class Login(Resource):
    def post(self):
        data     = request.get_json()
        username = data.get("username")
        password = data.get("password")

        with get_db_connection() as conn:
            cursor = conn.cursor()

            try:
                query(cursor, "SELECT * FROM users WHERE username = :u", {"u": username})
                user = cursor.fetchone()
            except oracledb.Error:
                return {"message": "An internal error has occurred"}, 500

            if user is None or not flask_bcrypt.check_password_hash(user.password, password):
                return {"message": BAD_LOGIN_MESSAGE}, 400

            update_login_time(conn, username)

            session_id     = create_session(username, cursor)
            session_cookie = sign_session_cookie(session_id)

            conn.commit()
            cursor.close()

            response = make_response(
                {
                    "displayName": username,
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
            conn.commit()
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
            render_template("auth.html", show_logout_button=True)
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
            query(
                cursor,
                """SELECT item_id, item_type, created_at
                   FROM favorites
                   WHERE userid = (SELECT userid FROM sessions WHERE sessionid = :sid)""",
                {"sid": session_id},
            )
            rows = cursor.fetchall()
            cursor.close()

        favorites = [
            {
                "item_id": row.item_id,
                "item_type": row.item_type,
                "created_at": row.created_at.isoformat(),
            }
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
                    """INSERT INTO favorites (userid, item_id, item_type, created_at)
                       VALUES (
                           (SELECT userid FROM sessions WHERE sessionid = :sid),
                           :item_id, :item_type, :created_at
                       )""",
                    {
                        "sid": session_id,
                        "item_id": str(item_id),
                        "item_type": item_type,
                        "created_at": utcnow(),
                    },
                )
                conn.commit()
            except oracledb.IntegrityError as e:
                # ORA-00001 is Oracle's unique constraint violation
                # (the T-SQL version checked 2627 / 2601 / "UQ_Favorite").
                if "ORA-00001" in str(e):
                    return {"message": "Already in favorites"}, 409
                return {"message": "An error occurred"}, 500
            except oracledb.Error:
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
                    """DELETE FROM favorites
                       WHERE userid = (SELECT userid FROM sessions WHERE sessionid = :sid)
                         AND item_id = :item_id
                         AND item_type = :item_type""",
                    {
                        "sid": session_id,
                        "item_id": str(item_id),
                        "item_type": item_type,
                    },
                )
                conn.commit()
            except oracledb.Error:
                return {"message": "An error occurred"}, 500
            finally:
                cursor.close()

        return {"message": "Removed from favorites"}, 200


# ── Page routes ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", **get_template_context())


@app.route("/moving-guide")
def moving_guide():
    return render_template("moving-guide.html", **get_template_context())


@app.route("/data/apartments")
def apartments():
    try:
        data = fetch_object("jsons/apartments.json")
        return Response(data, mimetype="application/json")
    except Exception:
        app.logger.exception("Failed to fetch apartments.json")
        return Response('{"message": "Apartment data unavailable"}',
                        status=503, mimetype="application/json")


@app.route("/data/events")
def events():
    try:
        data = fetch_object("jsons/catchdesmoines-events.json")
        return Response(data, mimetype="application/json")
    except Exception:
        app.logger.exception("Failed to fetch catchdesmoines-events.json")
        return Response('{"message": "Event data unavailable"}',
                        status=503, mimetype="application/json")


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


@app.route("/favicon.ico")
def favicon():
    data = fetch_object("icons/favicon.ico")
    return Response(data, mimetype="image/x-icon")


@app.route("/icons/<filename>")
def icons(filename):
    mimetypes = {
        "png": "image/png",
        "ico": "image/x-icon",
        "webmanifest": "application/manifest+json"
    }
    ext = filename.rsplit(".", 1)[-1]
    data = fetch_object(f"icons/{filename}")
    return Response(data, mimetype=mimetypes.get(ext, "application/octet-stream"))


@app.route("/healthz")
def healthz():
    """Cheap liveness check that touches the database.

    Curl this weekly from cron to reset the Always Free inactivity timer — ATP
    stops itself after 7 days without connections, and a stopped database that
    stays stopped for 90 cumulative days gets reclaimed and permanently deleted.
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM dual")
            cursor.fetchone()
            cursor.close()
        return {"status": "ok"}, 200
    except DatabaseWakingUpError:
        return {"status": "database waking up"}, 503
    except Exception:
        app.logger.exception("Health check failed")
        return {"status": "error"}, 500


if __name__ == "__main__":
    app.run(debug=True)