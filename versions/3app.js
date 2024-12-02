const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid'); // For unique process IDs

const app = express();
app.use(express.json()); // To parse JSON request bodies

// API endpoints
const apiUrls = [
    'https://topicsdict.eu/api/',
    // 'https://api2.example.com/endpoint',
    // 'https://api3.example.com/endpoint',
];

// Object to store intervals and results per process
const processes = {};

// Function to send a single request and handle its response
const sendRequest = async (processId, url, requestData) => {
    const startTime = Date.now(); // Record request start time
    try {
        const response = await axios.post(url, requestData);
        const endTime = Date.now(); // Record response time
        console.log(`Response from ${url} (Process: ${processId}):`, response.data);

        // Store request and response details
        processes[processId].results.push({
            request: { url, requestData },
            response: { data: response.data, timeTaken: endTime - startTime },
        });
    } catch (error) {
        const endTime = Date.now();
        console.error(`Error from ${url} (Process: ${processId}):`, error.message);

        // Store request and error details
        processes[processId].results.push({
            request: { url, requestData },
            response: { error: error.message, timeTaken: endTime - startTime },
        });
    }
};

// Main function to handle periodic requests
const sendRequests = async (processId, requestData) => {
    try {
        // Create an array of promises for all API URLs
        const promises = apiUrls.map((url) => sendRequest(processId, url, requestData));

        // Wait for all requests to complete
        await Promise.all(promises);

        console.log(`All requests for process ${processId} completed successfully.`);
    } catch (error) {
        console.error(`Error while sending requests for process ${processId}:`, error.message);
    }
};

// Start a new request loop
app.post('/start', (req, res) => {
    const { requestData, frequency } = req.body;

    // Ensure requestData is present
    if (!requestData) {
        return res.status(400).send({ error: 'requestData is required and must be valid JSON.' });
    }

    const processId = uuidv4(); // Generate a unique process ID

    console.log(`Starting process: ${processId}`);
    processes[processId] = {
        intervalId: setInterval(() => {
            sendRequests(processId, requestData);
        }, frequency || 1000), // Default: 1 second
        results: [],
    };

    res.send({ message: `Process started with ID: ${processId}`, processId });
});

// Stop a specific request loop
app.post('/stop', async (req, res) => {
    const { processId } = req.body;

    if (!processId) {
        return res.status(400).send({ error: 'processId is required.' });
    }

    const process = processes[processId];

    if (!process) {
        return res.status(400).send({ error: `No process running with ID: ${processId}` });
    }

    clearInterval(process.intervalId);

    // Save results to a JSON file
    await fs.writeFile(`results_${processId}.json`, JSON.stringify(process.results, null, 2));
    console.log(`Results saved for process: ${processId}`);

    delete processes[processId]; // Clean up after stopping

    res.send({ message: `Process stopped and results saved for ID: ${processId}` });
});

// List all active processes
app.get('/processes', (req, res) => {
    const activeProcesses = Object.keys(processes).map((id) => ({ processId: id }));
    res.send(activeProcesses);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
