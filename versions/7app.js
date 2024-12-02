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

// Object to store intervals, file handlers, and response counts per process
const processes = {};

// Maximum number of responses per file before rotating
const RESPONSES_PER_FILE = 2;

// Genrate Requests in subdirectories
const generateRequests = async (subdirectoryName, requestsPerFile) => {
    const subdirectoryPath = path.join(REQUESTS_DIR, subdirectoryName);

    // Create the subdirectory
    await fs.mkdir(subdirectoryPath, { recursive: true });

    let fileIndex = 1;
    let requestId = 1;

    console.log(`Starting request file generation in: ${subdirectoryPath}`);

    // Generate files dynamically until stopped manually
    while (true) {
        const requests = [];
        for (let i = 0; i < requestsPerFile; i++) {
            requests.push({
                id: `req_${requestId}`,
                data: { exampleField: `Example value ${requestId}` },
            });
            requestId++;
        }

        const filePath = path.join(subdirectoryPath, `requests_${fileIndex}.json`);
        await fs.writeFile(filePath, JSON.stringify(requests, null, 2));
        console.log(`Created file: ${filePath}`);

        fileIndex++;

        // Simulate delay or condition to stop (for manual testing, replace as needed)
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1-second delay
    }
};

app.get('/', (req, res)=>{
    console.log("Response sent");
    res.send("The Root Route.");
    
});
// Endpoint to start generating requests continuously
app.post('/generate-requests', async (req, res) => {
    const { subdirectoryName, requestsPerFile } = req.body;

    if (!subdirectoryName || typeof subdirectoryName !== 'string') {
        return res.status(400).send({ error: 'subdirectoryName is required and must be a string.' });
    }
    if (!requestsPerFile || typeof requestsPerFile !== 'number' || requestsPerFile <= 0) {
        return res.status(400).send({ error: 'requestsPerFile is required and must be a positive number.' });
    }

    try {
        // Run request generation in the background
        generateRequests(subdirectoryName, requestsPerFile);
        res.send({
            message: `Request generation started in subdirectory: ${subdirectoryName}`,
        });
    } catch (error) {
        console.error(`Error generating requests: ${error.message}`);
        res.status(500).send({ error: 'Failed to generate requests.' });
    }
});
// Genrate Requests in subdirectories (END)

// Function to append a response to a file
const appendResponseToFile = async (processId, responseData) => {
    const processDir = path.join('./responses', processId);
    const process = processes[processId];

    // Check if the file needs to be rotated
    if (process.responseCount >= RESPONSES_PER_FILE) {
        process.responseCount = 0; // Reset the counter
        process.currentFileIndex += 1; // Increment file index
    }

    const responseFile = path.join(processDir, `responses_${process.currentFileIndex}.json`);

    // Ensure atomic updates: Read, append, and write
    const fileExists = await fs.stat(responseFile).catch(() => false);
    const responseArray = fileExists ? JSON.parse(await fs.readFile(responseFile, 'utf-8')) : [];
    responseArray.push(responseData);

    // Write the updated array back to the file
    await fs.writeFile(responseFile, JSON.stringify(responseArray, null, 2));

    // Increment the response count only after successful write
    process.responseCount += 1;
};

// Function to send a single request and handle its response
const sendRequest = async (processId, url, requestData) => {
    const startTime = Date.now();

    // Non-blocking request handling
    axios.post(url, requestData)
        .then(async (response) => {
            const endTime = Date.now();
            console.log(`Response from ${url} (Process: ${processId}):`, response.data);

            // Write response directly to a file
            await appendResponseToFile(processId, {
                request: { url, requestData },
                response: { data: response.data, timeTaken: endTime - startTime },
            });
        })
        .catch(async (error) => {
            const endTime = Date.now();
            console.error(`Error from ${url} (Process: ${processId}):`, error.message);

            // Write error details directly to a file
            await appendResponseToFile(processId, {
                request: { url, requestData },
                response: { error: error.message, timeTaken: endTime - startTime },
            });
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
            await fs.unlink(filePath); // Delete the file immediately if empty
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
            // Delete the file immediately if all requests are processed
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
        responseCount: 0, // Counter for responses in the current file
        currentFileIndex: 1, // File index for naming response files
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
