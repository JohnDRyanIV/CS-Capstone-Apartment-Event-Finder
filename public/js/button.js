// Wait for the DOM to be loaded before attaching event handlers
document.addEventListener("DOMContentLoaded", () => {
	const incrementButton = document.getElementById("incrementButton");
	const counterSpan = document.getElementById("counter");

	// Initialize the counter
	let counter = 0; // Start from 0 each time the page loads
	counterSpan.innerText = counter; // Display the initial value

	// When the button is clicked, increment the counter
	incrementButton.addEventListener("click", () => {
		counter += 1;
		counterSpan.innerText = counter; // Update the displayed counter
	});
});
