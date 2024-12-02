const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { addDays, format } = require('date-fns'); // For date manipulation
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
// Qenerate Unique Requests from Template
// API to generate requests
// Import the template functions
// Import the template functions
const { generateAwayRequest, generateReturnRequest } = require('./templates.js');

const generateAndSaveRequests = async (
    departureIbnrs,
    arrivalIbnrs,
    startDate,
    endDate,
    travelClass,
    partnerCode,
    subdirectoryName,
    requestsPerFile
) => {
    const subdirectoryPath = path.join(REQUESTS_DIR, subdirectoryName);

    // Create the subdirectory
    await fs.mkdir(subdirectoryPath, { recursive: true });

    const start = new Date(startDate);
    const end = new Date(endDate);

    let fileIndex = 1;
    let requestId = 1;
    let requests = [];

    console.log(`Starting request file generation in: ${subdirectoryPath}`);

    for (let departure of departureIbnrs) {
        for (let arrival of arrivalIbnrs) {
            for (let currentDate = start; currentDate <= end; currentDate = addDays(currentDate, 1)) {
                const formattedDate = format(currentDate, 'yyyy-MM-dd');

                // Generate "away" request
                const awayRequest = generateAwayRequest(partnerCode, travelClass, departure, formattedDate, arrival);

                // Generate "return" request
                const returnRequest = generateReturnRequest(partnerCode, travelClass, arrival, formattedDate, departure);

                // Add both requests to the batch
                requests.push(awayRequest, returnRequest);
                requestId += 2;

                // Write requests to a file when reaching `requestsPerFile` count
                if (requests.length >= requestsPerFile) {
                    const filePath = path.join(subdirectoryPath, `requests_${fileIndex}.json`);
                    await fs.writeFile(filePath, JSON.stringify(requests, null, 2));
                    console.log(`Created file: ${filePath}`);
                    requests = [];
                    fileIndex++;
                }
            }
        }
    }

    // Write remaining requests if any
    if (requests.length > 0) {
        const filePath = path.join(subdirectoryPath, `requests_${fileIndex}.json`);
        await fs.writeFile(filePath, JSON.stringify(requests, null, 2));
        console.log(`Created file: ${filePath}`);
    }
};



// Genrate Requests in subdirectories
// Endpoint to trigger request generation and file saving
app.post('/rail-requests', async (req, res) => {
    const { departureIbnrs, arrivalIbnrs, startDate, endDate, travelClass, partnerCode, subdirectoryName, requestsPerFile } = req.body;

    if (!departureIbnrs || !arrivalIbnrs || !startDate || !endDate || !travelClass || !partnerCode || !subdirectoryName || !requestsPerFile) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        await generateAndSaveRequests(departureIbnrs, arrivalIbnrs, startDate, endDate, travelClass, partnerCode, subdirectoryName, requestsPerFile);
        res.status(200).json({ message: "Requests successfully generated and saved to files." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
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
const processFilesAtInterval = async (processId, directoryName) => {
    const processDir = path.join(REQUESTS_DIR, directoryName); // Use the subdirectory
    const files = await fs.readdir(processDir).catch(() => []); // Safely read directory

    if (files.length === 0) {
        console.log(`No files to process for process ${processId} in directory ${directoryName}`);
        clearInterval(processes[processId].intervalId); // Stop interval if no files
        return;
    }

    for (const file of files) {
        const filePath = path.join(processDir, file); // Process each file in the subdirectory
        const success = await processRequestFromFile(processId, filePath);

        if (!success) {
            console.log(`No requests processed from ${filePath}.`);
        }
    }
};

// Start a new request loop
app.post('/start', async (req, res) => {
    const { interval, directoryName } = req.body;

    // Validate inputs
    if (!directoryName || typeof directoryName !== 'string') {
        return res.status(400).send({ error: 'directoryName is required and must be a string.' });
    }

    if (!interval || typeof interval !== 'number') {
        return res.status(400).send({ error: 'Interval (in milliseconds) is required and must be a number.' });
    }

    const processId = uuidv4(); // Generate a unique process ID
    console.log(`Starting process: ${processId} for directory: ${directoryName}`);

    const processDir = path.join(REQUESTS_DIR, directoryName);

    // Ensure the directory exists
    const dirExists = await fs.stat(processDir).catch(() => false);
    if (!dirExists) {
        return res.status(400).send({ error: `Directory ${directoryName} does not exist in ${REQUESTS_DIR}.` });
    }

    // Create a directory for storing responses
    const responseDir = path.join('./responses', processId);
    await fs.mkdir(responseDir, { recursive: true });

    // Store process details
    processes[processId] = {
        intervalId: setInterval(() => processFilesAtInterval(processId, directoryName), interval),
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

app.get('/', (req, res)=>{
    console.log("Response sent");
    res.send("The Root Route.");
    
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
