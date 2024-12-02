const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;

const app = express();
app.use(express.json()); // To parse JSON request bodies

// API endpoints
const apiUrls = [
    'https://topicsdict.eu/api/',
    // 'https://api2.example.com/endpoint',
    // 'https://api3.example.com/endpoint',
];

// Store results
let results = [];
let intervalId = null;

// Function to send a single request and handle its response
const sendRequest = async (url, requestData) => {
    const startTime = Date.now(); // Record request start time
    try {
        const response = await axios.post(url, requestData);
        const endTime = Date.now(); // Record response time
        console.log(`Response from ${url}:`, response.data);

        // Store request and response details
        results.push({
            request: { url, requestData },
            response: { data: response.data, timeTaken: endTime - startTime },
        });
    } catch (error) {
        const endTime = Date.now();
        console.error(`Error from ${url}:`, error.message);

        // Store request and error details
        results.push({
            request: { url, requestData },
            response: { error: error.message, timeTaken: endTime - startTime },
        });
    }
};

// Main function to handle periodic requests
const sendRequests = async (requestData) => {
    const promises = apiUrls.map((url) => sendRequest(url, requestData));
    await Promise.all(promises);
};

// Start the request loop
app.post('/start', (req, res) => {
    const { req: requestType, code, datetime } = req.body; // Destructure the JSON structure
    const frequency = 1000; // Set frequency (default: 1 second)

    // Validate the incoming data
    if (!requestType || !code || !datetime) {
        return res.status(400).send({
            error: 'Invalid request format. Required keys: req, code, datetime.',
        });
    }

    if (intervalId) {
        return res.status(400).send({
            error: 'Request process already running.',
        });
    }

    console.log('Starting requests...');
    intervalId = setInterval(() => {
        sendRequests({ req: requestType, code, datetime });
    }, frequency);

    res.send({
        message: 'Requests started.',
        requestType,
        code,
        datetime,
    });
});

// Endpoint to stop the requests
app.post('/stop', (req, res) => {
    if (!intervalId) {
        return res.status(400).send({
            error: 'No running request process to stop.',
        });
    }

    clearInterval(intervalId);
    intervalId = null;
    console.log('Requests stopped.');
    res.send({ message: 'Requests stopped.' });
});

// Endpoint to get the stored results
app.get('/results', async (req, res) => {
    try {
        res.send(results);
    } catch (error) {
        res.status(500).send({
            error: 'Error retrieving results.',
        });
    }
});

// Server setup
const PORT = 3006;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
