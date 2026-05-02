// This file should be placed in static/js, and should be called signin.js

// characters enclosed in / / are regular expressions
// ^ means start of the string
// $ means end of the string
// [a-zA-Z0-9] means any alphanumeric character
// {1,20} means between 1 and 20 characters
// So this regular expression matches any string that contains between 1 and 20 alphanumeric characters
const USERNAME_PATTERN = /^[a-zA-Z0-9]{1,20}$/;

// Password validation
// \x21-\x7E is a range of ASCII characters from ! to ~s
// you can find a list of ascii characters at https://ss64.com/ascii.html
const PASSWORD_PATTERN = /^[\x21-\x7E]{8,}$/; // No spaces, at least 8 characters

// Helper function to add bootstrap's is-valid class to our element, and remove the is-invalid class.
const setValid = (input) => {
	input.classList.remove("is-invalid");
	input.classList.add("is-valid");
};

// Helper functions to set error and valid states
const setError = (input, message) => {
	input.classList.add("is-invalid");
	input.classList.remove("is-valid");
	const feedback = input.parentElement.querySelector(".invalid-feedback");
	if (feedback) {
		feedback.textContent = message;
	}
};

function validatePassword(id) {
	const password = document.getElementById(id);
	// this syntax below is for regular expressions

	// Here, we are checking if the password matches the regular expression
	// this is done via the `test` method
	// We use the `.value` property to get the value of the input element, that is, the
	// text entered by the user.
	if (!PASSWORD_PATTERN.test(password.value)) {
		setError(
			password,
			"Password must be at least 8 characters with no spaces.",
		);
		return false;
	}

	setValid(password);
	return true;
}

// Username validation
function validateUsername(id) {
	const username = document.getElementById(id);

	if (!USERNAME_PATTERN.test(username.value)) {
		setError(
			username,
			"Username must be alphanumeric and at most 20 characters.",
		);
		return false;
	}
	setValid(username);

	return true;
}

async function registerCallback(response) {
	// Fetching the json returns a promise, and we need to await it.
	result = await response.json();
	if (!response.ok) {
		alert("Registration failed: " + result.message);
		return;
	}
	alert("Registration successful! Welcome, " + result.displayName);
	// You can redirect the user to another page here. It is commented for right now.
	// window.location.href = "/";
	return;
}

// We validate the register form here
function validateRegisterForm(event) {
	event.preventDefault(); // Prevent default form submission

	let isValid = validatePassword("registerPassword");
	// We need to call validateUsername in order to add the is-invalid class to the input element
	// So we place it on the left of the `&&`.
	// Javascript has short-circuit evaluation,
	// so if we place it on the right, it will not be called if the password was not valid.
	isValid = validateUsername("registerUsername") && isValid;

	if (!isValid) {
		// We always need to return false, even if the form is valid.
		// this prevents the browser from invoking the default form logic,
		// which would prevent our own validation logic from running.
		return false;
	}

	username = document.getElementById("registerUsername");
	password = document.getElementById("registerPassword");
	displayName = document.getElementById("registerDisplayName");

	// Send REST request if form is valid
	const formData = {
		username: username.value,
		password: password.value,
		displayName: displayName.value,
	};

	// Fill in the request object that is being sent to the server.
	const request = {
		method: "POST", // We are using the post request
		headers: { "Content-Type": "application/json" }, // This is the header we are sending.
		body: JSON.stringify(formData), // Since this is a POST, we send a payload here
	};

	// fetch returns a promise, which is an object representing the completion or failure of the async operation
	// We attach a .then() method to the promise to handle the response once the operation is complete
	fetch("/register", request)
		.then(registerCallback)
		.catch(() => alert("An error occurred. Please try again."));
}

function loginCallback(response) {
	if (!response.ok) {
		response.json().then(data => {
			alert(data.message || "Login failed.");
		});
		return;
	}

	response.json().then(data => {
		alert(`Welcome back, ${data.displayName}! Last login: ${data.lastLogin}`);

		// Hide modal if open (optional)
		const loginModal = bootstrap.Modal.getInstance(document.getElementById("loginModal"));
		if (loginModal) {
			loginModal.hide();
		}

		// Redirect to auth page
		window.location.href = "/auth";
	});
}

  function validateLoginForm(event) {
	event.preventDefault(); // Prevent default form submission
  
	let isValid = validatePassword("loginPassword");
	isValid = validateUsername("loginUsername") && isValid;
  
	if (!isValid) return false;
  
	const username = document.getElementById("loginUsername").value;
	const password = document.getElementById("loginPassword").value;
  
	const loginData = { username, password };
  
	const request = {
	  method: "POST",
	  headers: { "Content-Type": "application/json" },
	  body: JSON.stringify(loginData),
	  credentials: "include"  // needed if backend sets cookies and CORS is used
	};
  
	fetch("/login", request)
	  .then(loginCallback)
	  .catch(() => alert("An error occurred during login."));
  }

// This onReady ensures that the DOM is loaded before the event listeners are attached
// Which is necessary in the rare case that our script is loaded before the DOM is fully loaded
// This is a good practice to follow when writing JavaScript code.
// If the readyState is not loading, then we can just add our callback anyway.
function onReady(callback) {
	document.readyState === "loading"
		? document.addEventListener("DOMContentLoaded", callback)
		: callback();
}

function clearValidation(event) {
	event.target.classList.remove("is-invalid", "is-valid");
}

function clearForm(id) {
	const form = document.getElementById(id);
	if (form) {
		// reset the form to clear all input elements
		form.reset();
		// We also need to remove the bootstrap classes that indicate validation state
		form.classList.remove("was-validated");
		// for loop, iterate over all children of the form
		for (const input of form.querySelectorAll(".form-control")) {
			// Remove the classes that indicate validation state
			input.classList.remove("is-invalid", "is-valid");
		}
	}
}

// This function adds event listeners to each element
function attachEventListeners() {
	// First, we get the form element
	const registerForm = document.getElementById("registerForm");
	// We add an event listener to the form element
	// `?` is javascript's null coalescing. It does nothing if the value is null or undefined
	registerForm?.addEventListener("submit", validateRegisterForm);
	// We add event listeners to each input element so that when they are changed, the validation classes are removed
	for (const input of document.querySelectorAll("input")) {
		input.addEventListener("input", clearValidation);
	}
	// We add an event listener to the modal so that when it is hidden, the form is cleared
	// This hidden.bs.modal class is added by bootstrap when the modal is hidden
	const registerModal = document.getElementById("registerModal");
	registerModal?.addEventListener("hidden.bs.modal", clearForm);

	const loginForm = document.getElementById("loginForm");
	loginForm?.addEventListener("submit", validateLoginForm);

	const loginModal = document.getElementById("loginModal");
	loginModal?.addEventListener("hidden.bs.modal", clearForm);
}

// The only top-level code in this file is the call to onReady.
// this will handle all of the logic we defined above.
onReady(attachEventListeners);
