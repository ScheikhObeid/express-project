const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { addDays, format } = require('date-fns'); // For date manipulation

const app = express();
const server = http.createServer(app); // Create HTTP server
const io = new Server(server); // Attach Socket.IO to the HTTP server

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Directory containing request files
const REQUESTS_DIR = './requests';
// Maximum number of responses per file before rotating
const RESPONSES_PER_FILE = 10;
// Object to store intervals, file handlers, and response counts per process
const processes = {}; // Object to store active processes

// API endpoints
const apiUrls = [
    'https://topicsdict.eu/api/',
    // Add more API endpoints if needed
];

// Broadcast active processes to clients
function broadcastActiveProcesses() {
    const activeProcesses = Object.values(processes).map((process) => ({
        processId: process.processId,
    }));
    io.emit('activeProcesses', activeProcesses);
}

// Handle WebSocket connections
io.on('connection', (socket) => {
    console.log('A client connected');
    socket.emit('activeProcesses', Object.values(processes).map((process) => ({
        processId: process.processId,
    }))); // Send initial data
    socket.on('disconnect', () => {
        console.log('A client disconnected');
    });
});

// Qenerate Unique Requests from Template
// API to generate requests
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
const appendResponseToFile = async (directoryName, responseData) => {
    const process = processes[directoryName]; // Access process details by directoryName
    const processDir = path.join('./responses', process.processId); // Use processId for responses

    if (process.lock) {
        await new Promise((resolve) => {
            const interval = setInterval(() => {
                if (!process.lock) {
                    clearInterval(interval);
                    resolve();
                }
            }, 10);
        });
    }

    process.lock = true; // Lock the process

    try {
        if (process.responseCount >= RESPONSES_PER_FILE) {
            process.responseCount = 0;
            process.currentFileIndex += 1;
        }

        const responseFile = path.join(processDir, `responses_${process.currentFileIndex}.json`);
        const fileExists = await fs.stat(responseFile).catch(() => false);
        const responseArray = fileExists ? JSON.parse(await fs.readFile(responseFile, 'utf-8')) : [];
        responseArray.push(responseData);

        await fs.writeFile(responseFile, JSON.stringify(responseArray, null, 2));
        process.responseCount += 1;
    } finally {
        process.lock = false; // Release the lock
    }
};

// Function to send a single request and handle its response
const sendRequest = async (directoryName, url, requestData) => {
    const process = processes[directoryName];
    const startTime = Date.now();

    axios.post(url, requestData, {
        headers: {
            Authorization: 'R8MuZtLyRhWvZS196L1Fd',
        },
    })
        .then(async (response) => {
            const endTime = Date.now();
            console.log(`Response from ${url} (Directory: ${process.processId}):`, response.data);

            // Write response directly to a file
            await appendResponseToFile(process.processId, {
                request: { url, requestData },
                response: { data: response.data, timeTaken: endTime - startTime },
            });
        })
        .catch(async (error) => {
            const endTime = Date.now();
            console.error(`Error from ${url} (Directory: ${process.processId}):`, error.message);

            // Write error details directly to a file
            await appendResponseToFile(process.processId, {
                request: { url, requestData },
                response: { error: error.message, timeTaken: endTime - startTime },
            });
        });
};

// Function to process a single request from a file
const processRequestFromFile = async (directoryName, filePath) => {
    const process = processes[directoryName];
    try {
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
        apiUrls.forEach((url) => sendRequest(process.processId, url, requestData));

        // Update the file with the remaining requests
        if (requests.length > 0) {
            await fs.writeFile(filePath, JSON.stringify(requests, null, 2));
        } else {
            await fs.unlink(filePath);
            console.log(`File deleted: ${filePath}`);
            return;
        }

        return true; // Successfully initiated a request
    } catch (error) {
        console.error(`Error processing file ${filePath}:`, error.message);
        return false;
    }
};

// Function to process files at intervals
const processFilesAtInterval = async (directoryName) => {
    const process = processes[directoryName];
    const processDir = path.join(REQUESTS_DIR, process.processId); // Use processId for directory

    const files = await fs.readdir(processDir).catch(() => []);
    if (files.length === 0) {
        console.log(`No files to process in directory: ${process.processId}`);
        clearInterval(process.intervalId);
        delete processes[directoryName];
        try {
            await fs.rm(processDir, { recursive: true }); // Use `recursive` for non-empty directories
            console.log(`Directory "${processDir}" deleted successfully.`);
        } catch (deleteError) {
            console.error(`Failed to delete directory "${processDir}":`, deleteError.message);
        }
        broadcastActiveProcesses();
        return;
    }

    for (const file of files) {
        const filePath = path.join(processDir, file);
        try {
            await processRequestFromFile(directoryName, filePath); // Process the file
            console.log(file);
        } catch (error) {
            console.error(`Failed to process file ${filePath}:`, error.message);
        }
    }
};

// Start a new request loop
app.post('/start', async (req, res) => {
    const { interval, directoryName } = req.body;

    if (!directoryName || typeof directoryName !== 'string') {
        return res.status(400).send({ error: 'directoryName is required and must be a string.' });
    }

    if (!interval || typeof interval !== 'number') {
        return res.status(400).send({ error: 'Interval (in milliseconds) is required and must be a number.' });
    }

    console.log(`Starting process for directory: ${directoryName}`);

    const processDir = path.join(REQUESTS_DIR, directoryName);
    const dirExists = await fs.stat(processDir).catch(() => false);

    if (!dirExists) {
        return res.status(400).send({ error: `Directory ${directoryName} does not exist.` });
    }

    const responseDir = path.join('./responses', directoryName);
    await fs.mkdir(responseDir, { recursive: true });

    processes[directoryName] = {
        processId: directoryName, // Explicitly store processId
        intervalId: setInterval(() => processFilesAtInterval(directoryName), interval),
        responseCount: 0,
        currentFileIndex: 1,
    };

    broadcastActiveProcesses();
    res.send({ message: `Process started for directory: ${directoryName}` });
});

// Stop a specific request loop
function stopProcess(directoryName, processes) {
    if (!directoryName || typeof directoryName !== 'string') {
        return { success: false, error: 'directoryName is required and must be a string.' };
    }

    const process = processes[directoryName];
    if (!process) {
        return { success: false, error: `No process found for directory: ${directoryName}` };
    }

    clearInterval(process.intervalId);
    delete processes[directoryName];
    broadcastActiveProcesses();
    console.log(`Process for directory "${process.processId}" stopped.`);
    return { success: true, message: `Process for directory "${process.processId}" stopped successfully.` };
}

app.post('/stop', async (req, res) => {
    const { directoryName } = req.body;

    const result = stopProcess(directoryName, processes);
    if (result.success) {
        res.send({ message: result.message });
    } else {
        res.status(400).send({ error: result.error });
    }
});

// List all active processes
app.get('/processes', (req, res) => {
    const activeProcesses = Object.values(processes).map((process) => ({
        processId: process.processId,
    }));
    res.send(activeProcesses);
});

app.get('/home', (req, res) => {
    console.log("Response sent");
    res.send("The Root Route.");
});


// Start the server using `server.listen()`
const PORT = 3000;
// Serve static files from the "frontend" directory
app.use(express.static(path.join(__dirname, 'frontend')));

// Fallback to index.html for any other routes (useful for SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
