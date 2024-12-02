<?php
header("Content-Type: application/json");

// Get the raw POST data
$requestPayload = file_get_contents("php://input");

// Decode the JSON request
$requestData = json_decode($requestPayload, true);

// Check if JSON decoding succeeded
if ($requestData === null) {
    echo json_encode([
        "error" => "Invalid JSON format.",
        "json_error" => json_last_error_msg()
    ]);
    exit;
}

// Check if the required keys exist in the request
if (
    isset($requestData)
) {
    // Prepare the response
    $response['departure'] = $requestData['departure']['ibnr'];
    $response['date_time'] = $requestData['departure']['date_time'];
    $response['arrival'] = $requestData['arrival']['ibnr'];

    // Send the JSON response
    echo json_encode($response);
} else {
    // Send an error response if required keys are missing
    echo json_encode([
        "error" => "Invalid request format. Required keys: req, code, datetime."
    ]);
}
