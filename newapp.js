const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs'); // For synchronous methods like existsSync
const fsPromises = require('fs').promises; // For promise-based methods
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
const RESPONSES_DIR  = './responses';
// Maximum number of responses per file before rotating
const RESPONSES_PER_FILE = 10;
// Object to store intervals, file handlers, and response counts per process
const processes = {}; // Object to store active processes

// API endpoints
// const apiUrl = 'https://topicsdict.eu/api/';
let apiUrl = null;

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
    console.log(`Start processing file: ${filePath}`); // Log file start
    const process = processes[directoryName];
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const requests = JSON.parse(fileContent);

        if (requests.length === 0) {
            console.log(`No requests left in file: ${filePath}`);
            await fs.unlink(filePath); // Delete the file immediately if empty
            return false; // No requests to process
        }

        const requestData = requests.shift();

        // await Promise.all(apiUrls.map((url) => sendRequest(process.processId, url, requestData)));
        await sendRequest(process.processId, apiUrl, requestData);

        if (requests.length > 0) {
            await fs.writeFile(filePath, JSON.stringify(requests, null, 2));
        } else {
            await fs.unlink(filePath);
            console.log(`File deleted: ${filePath}`);
        }

        console.log(`Finished processing file: ${filePath}`); // Log file finish
        return true;
    } catch (error) {
        console.error(`Error processing file ${filePath}:`, error.message);
        return false;
    }
};

// Function to process files at intervals
const processFilesAtInterval = async (directoryName) => {
    const process = processes[directoryName];
    const processDir = path.join(REQUESTS_DIR, process.processId); // Use processId for directory

    const files = await fs.readdir(processDir).catch(() => []); // Get the list of files
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

    // Process files sequentially
    for (const file of files) {
        const filePath = path.join(processDir, file);
        console.log(`Processing file: ${file}`); // Log the file being processed
        await processRequestFromFile(directoryName, filePath); // Wait for each file to finish
    }
};
// #################################################################################
// Active processors map to keep track of running processes
const processors = {};

// Function to process files in a directory
const processFilesInDirectory = async (directoryName, interval, APIEndpoint) => {
  const requestDir = path.resolve(REQUESTS_DIR, directoryName);
  const responseDir = path.resolve(RESPONSES_DIR, directoryName);
  const processId = directoryName;

  if (!fs.existsSync(responseDir)) {
    await fsPromises.mkdir(responseDir, { recursive: true });
  }

  console.log(`Starting processor for ${processId}`);

  // Response aggregation state
  let currentFileIndex = 0;
  let currentResponses = [];

  const saveResponsesToFile = async () => {
    const responseFile = path.join(responseDir, `responses_${currentFileIndex}.json`);
    await fsPromises.writeFile(responseFile, JSON.stringify(currentResponses, null, 2));
    console.log(`Saved ${currentResponses.length} responses to ${responseFile}`);
    currentResponses = [];
    currentFileIndex++;
  };

  const processFiles = async () => {
    const files = (await fsPromises.readdir(requestDir)).filter(file => file.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(requestDir, file);
      const data = await fsPromises.readFile(filePath, 'utf-8');
      const requests = JSON.parse(data);

      while (requests.length > 0) {
        const request = requests.shift();

        try {
          const response = await axios.post(APIEndpoint, request);
          currentResponses.push(response.data);
          console.log(`Processed request, currentResponses: ${currentResponses.length}`);

          if (currentResponses.length >= RESPONSES_PER_FILE) {
            await saveResponsesToFile();
          }
        } catch (err) {
          console.error(`Error processing request: ${err.message}`);
        }

        await fsPromises.writeFile(filePath, JSON.stringify(requests, null, 2));

        if (requests.length === 0) {
          await fsPromises.unlink(filePath);
          console.log(`File processed and deleted: ${filePath}`);
        }

        // Enforce the interval between requests
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
  };

  while (processors[processId]) {
    try {
      await processFiles();
    } catch (err) {
      console.error(`Error in processing loop for ${processId}:`, err.message);
    }
    // Enforce the interval between processing batches
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  if (currentResponses.length > 0) {
    await saveResponsesToFile();
  }
  console.log(`Stopped processor for ${processId}`);
};

app.post('/start', (req, res) => {
  const { directoryName, interval, APIEndpoint } = req.body;

  console.log('Received request to start process with parameters:', {
    directoryName,
    interval,
    APIEndpoint,
  });

  if (!directoryName || typeof directoryName !== 'string') {
    return res.status(400).json({ message: 'Invalid or missing directoryName.' });
  }
  if (!interval || typeof interval !== 'number') {
    return res.status(400).json({ message: 'Invalid or missing interval.' });
  }
  if (!APIEndpoint || typeof APIEndpoint !== 'string') {
    return res.status(400).json({ message: 'Invalid or missing APIEndpoint.' });
  }

  const requestDir = path.resolve(REQUESTS_DIR, directoryName);

  if (processors[directoryName]) {
    return res.status(400).json({ message: `Process ${directoryName} is already running.` });
  }

  if (!fs.existsSync(requestDir)) {
    return res.status(400).json({ message: `Request directory does not exist: ${requestDir}` });
  }

  try {
    processors[directoryName] = true; // Mark this process as active
    processFilesInDirectory(directoryName, interval, APIEndpoint);
    res.json({ message: `Process ${directoryName} started.` });
  } catch (error) {
    console.error('Error starting process:', error.message);
    res.status(500).json({ message: 'Failed to start process.', error: error.message });
  }
});

app.post('/stop', (req, res) => {
  const { processId } = req.body;

  if (!processors[processId]) {
    return res.status(400).json({ message: `Process ${processId} is not running.` });
  }

  processors[processId] = false;
  res.json({ message: `Process ${processId} stopped.` });
});
// ###############################################################################################################################
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
