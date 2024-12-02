const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // For unique process IDs

const app = express();
app.use(express.json()); // To parse JSON request bodies

// API endpoints
const apiUrls = [
    'https://topicsdict.eu/api/',
    // Add more API endpoints if needed
];

// Directory containing request files
const REQUESTS_DIR = './requests';

// Object to store intervals and results per process
const processes = {};

// Function to send a single request and handle its response
const sendRequest = async (processId, url, requestData) => {
    const startTime = Date.now();

    // Non-blocking request handling
    axios.post(url, requestData)
        .then(async (response) => {
            const endTime = Date.now();
            console.log(`Response from ${url} (Process: ${processId}):`, response.data);

            // Write response to a file in the process directory
            const processDir = path.join('./responses', processId);
            const responseFile = path.join(processDir, `${Date.now()}_${uuidv4()}.json`);
            await fs.writeFile(responseFile, JSON.stringify({
                request: { url, requestData },
                response: { data: response.data, timeTaken: endTime - startTime },
            }, null, 2));

        }).catch(async (error) => {
            const endTime = Date.now();
            console.error(`Error from ${url} (Process: ${processId}):`, error.message);

            // Write error details to a file in the process directory
            const processDir = path.join('./responses', processId);
            const errorFile = path.join(processDir, `${Date.now()}_${uuidv4()}.json`);
            await fs.writeFile(errorFile, JSON.stringify({
                request: { url, requestData },
                response: { error: error.message, timeTaken: endTime - startTime },
            }, null, 2));
        });
};

// Function to process a single request from a file
const processRequestFromFile = async (processId, filePath) => {
    try {
        // Read the file content
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const requests = JSON.parse(fileContent);

        if (requests.length === 0) {
            console.log(`No requests left in file: ${filePath}`);
            await fs.unlink(filePath); // Delete the file if it's empty
            return false; // No requests to process
        }

        // Get the first request
        const requestData = requests.shift();

        // Send the request to all APIs without waiting for responses
        apiUrls.forEach((url) => sendRequest(processId, url, requestData));

        // Update the file with the remaining requests
        if (requests.length > 0) {
            await fs.writeFile(filePath, JSON.stringify(requests, null, 2));
        } else {
            // Delete the file if all requests are processed
            await fs.unlink(filePath);
            console.log(`File deleted: ${filePath}`);
        }

        return true; // Successfully initiated a request
    } catch (error) {
        console.error(`Error processing file ${filePath}:`, error.message);
        return false;
    }
};

// Function to process files at intervals
const processFilesAtInterval = async (processId) => {
    const files = await fs.readdir(REQUESTS_DIR);

    if (files.length === 0) {
        console.log(`No files to process for process ${processId}`);
        clearInterval(processes[processId].intervalId); // Stop interval if no files
        return;
    }

    for (const file of files) {
        const filePath = path.join(REQUESTS_DIR, file); // Process each file
        const success = await processRequestFromFile(processId, filePath);

        if (!success) {
            console.log(`No requests processed from ${filePath}.`);
        }
    }
};

// Start a new request loop
app.post('/start', async (req, res) => {
    const { interval } = req.body;

    if (!interval || typeof interval !== 'number') {
        return res.status(400).send({ error: 'Interval (in milliseconds) is required and must be a number.' });
    }

    const processId = uuidv4(); // Generate a unique process ID
    console.log(`Starting process: ${processId}`);

    // Create a directory for storing responses
    const processDir = path.join('./responses', processId);
    await fs.mkdir(processDir, { recursive: true });

    processes[processId] = {
        intervalId: setInterval(() => processFilesAtInterval(processId), interval),
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

    console.log(`Process ${processId} stopped.`);
    delete processes[processId]; // Clean up after stopping

    res.send({ message: `Process stopped for ID: ${processId}` });
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
