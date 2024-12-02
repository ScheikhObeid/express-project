const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;

const app = express();
app.use('/start', express.json()); // To parse JSON request bodies

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
    const { requestData, frequency } = req.body; // requestData and frequency (in ms)

    if (intervalId) {
        return res.status(400).send({ error: 'Request process already running.' });
    }

    console.log('Starting requests...');
    intervalId = setInterval(() => {
        sendRequests(requestData);
    }, frequency || 1000); // Default: 1 second

    res.send({ message: 'Requests started.' });
});

// Stop the request loop
app.post('/stop', express.raw({ type: '*/*' }), async (req, res) => {
    if (!intervalId) {
        return res.status(400).send({ error: 'No request process running.' });
    }

    clearInterval(intervalId);
    intervalId = null;

    // Save results to a JSON file
    await fs.writeFile('results.json', JSON.stringify(results, null, 2));
    console.log('Results saved to results.json');
    results = []; // Clear results after saving

    res.send({ message: 'Requests stopped and results saved.' });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
