#!/usr/bin/env node
/**
 * DORM API Test Script
 *
 * This script tests the CRUD functionality of the DORM API running on localhost:3000.
 * No external dependencies required - uses only built-in Node.js modules.
 *
 * Usage:
 *   node test-dorm-api.js
 */

const http = require("http");
const { URL } = require("url");

// Configuration
const API_HOST = "localhost";
const API_PORT = 3000;
const API_BASE = `http://${API_HOST}:${API_PORT}`;

// Test data
let createdRecordId = null;

// Utility Functions
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, type = "info") {
  const timestamp = new Date().toISOString().substring(11, 19);

  switch (type) {
    case "success":
      console.log(
        `${colors.dim}[${timestamp}]${colors.reset} ${colors.green}✓${colors.reset} ${message}`,
      );
      break;
    case "error":
      console.log(
        `${colors.dim}[${timestamp}]${colors.reset} ${colors.red}✗${colors.reset} ${message}`,
      );
      break;
    case "warn":
      console.log(
        `${colors.dim}[${timestamp}]${colors.reset} ${colors.yellow}!${colors.reset} ${message}`,
      );
      break;
    case "title":
      console.log(`\n${colors.bright}${colors.blue}${message}${colors.reset}`);
      break;
    default:
      console.log(`${colors.dim}[${timestamp}]${colors.reset} ${message}`);
  }
}

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);

    const options = {
      method: method,
      hostname: API_HOST,
      port: API_PORT,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
      },
    };

    const req = http.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        let parsedData;
        try {
          parsedData = JSON.parse(responseData);
        } catch (e) {
          parsedData = { raw: responseData };
        }

        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsedData,
        });
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    log(`${message}: ${colors.green}PASS${colors.reset}`, "success");
    return true;
  } else {
    log(`${message}: ${colors.red}FAIL${colors.reset}`, "error");
    log(`  Expected: ${JSON.stringify(expected)}`, "error");
    log(`  Actual:   ${JSON.stringify(actual)}`, "error");
    return false;
  }
}

// Test Suites

async function testCreateRecord() {
  log("Testing CREATE operation", "title");

  // Test valid creation
  const testRecord = {
    name: "Test Record " + Date.now(),
    value: 42.5,
  };

  log(`Creating record: ${JSON.stringify(testRecord)}`);
  const response = await makeRequest("POST", "/api/records", testRecord);

  if (assertEqual(response.status, 200, "Response status")) {
    assertEqual(response.data.success, true, "Success flag");

    if (response.data.id) {
      createdRecordId = response.data.id;
      log(`Record created with ID: ${createdRecordId}`, "success");
    } else {
      log("No ID returned from create operation", "error");
    }
  }

  // Test invalid creation (missing required fields)
  log("Testing invalid record creation (missing fields)");
  const invalidResponse = await makeRequest("POST", "/api/records", {
    name: "Missing Value",
  });
  assertEqual(invalidResponse.status, 400, "Invalid record status");
  assertEqual(
    invalidResponse.data.success,
    false,
    "Invalid record success flag",
  );
}

async function testReadRecords() {
  log("Testing READ operations", "title");

  // Test reading all records
  log("Getting all records");
  const listResponse = await makeRequest("GET", "/api/records");

  assertEqual(listResponse.status, 200, "List response status");
  assertEqual(listResponse.data.success, true, "List success flag");

  if (listResponse.data.records) {
    log(`Found ${listResponse.data.records.length} records`, "success");
  }

  // Test reading a specific record
  if (createdRecordId) {
    log(`Getting record with ID: ${createdRecordId}`);
    const singleResponse = await makeRequest(
      "GET",
      `/api/records/${createdRecordId}`,
    );

    assertEqual(singleResponse.status, 200, "Single record response status");
    assertEqual(
      singleResponse.data.success,
      true,
      "Single record success flag",
    );

    if (singleResponse.data.record) {
      log(
        `Found record: ${JSON.stringify(singleResponse.data.record)}`,
        "success",
      );
    }
  }

  // Test reading a non-existent record
  const nonExistentId = 999999;
  log(`Testing non-existent record ID: ${nonExistentId}`);
  const notFoundResponse = await makeRequest(
    "GET",
    `/api/records/${nonExistentId}`,
  );

  assertEqual(notFoundResponse.status, 404, "Non-existent record status");
  assertEqual(
    notFoundResponse.data.success,
    false,
    "Non-existent record success flag",
  );

  // Test filtering
  log("Testing filtering capabilities");
  const filterResponse = await makeRequest(
    "GET",
    "/api/records?minValue=10&limit=5",
  );

  assertEqual(filterResponse.status, 200, "Filter response status");
  assertEqual(filterResponse.data.success, true, "Filter success flag");

  if (filterResponse.data.pagination) {
    log(
      `Filtered records: ${filterResponse.data.records.length} (limit: ${filterResponse.data.pagination.limit})`,
      "success",
    );
  }
}

async function testUpdateRecord() {
  log("Testing UPDATE operation", "title");

  if (!createdRecordId) {
    log("No record ID available for update test", "warn");
    return;
  }

  // Test valid update
  const updates = {
    name: "Updated Record " + Date.now(),
    value: 99.9,
  };

  log(`Updating record ${createdRecordId} with: ${JSON.stringify(updates)}`);
  const updateResponse = await makeRequest(
    "PUT",
    `/api/records/${createdRecordId}`,
    updates,
  );

  assertEqual(updateResponse.status, 200, "Update response status");
  assertEqual(updateResponse.data.success, true, "Update success flag");

  // Verify the update took effect
  log("Verifying update applied correctly");
  const verifyResponse = await makeRequest(
    "GET",
    `/api/records/${createdRecordId}`,
  );

  if (verifyResponse.data.record) {
    const record = verifyResponse.data.record;
    assertEqual(record.name, updates.name, "Updated name field");
    assertEqual(record.value, updates.value, "Updated value field");
  }

  // Test partial update
  const partialUpdate = {
    value: 77.7,
  };

  log(`Testing partial update with: ${JSON.stringify(partialUpdate)}`);
  const partialResponse = await makeRequest(
    "PUT",
    `/api/records/${createdRecordId}`,
    partialUpdate,
  );

  assertEqual(partialResponse.status, 200, "Partial update status");

  // Verify partial update
  const partialVerifyResponse = await makeRequest(
    "GET",
    `/api/records/${createdRecordId}`,
  );

  if (partialVerifyResponse.data.record) {
    const record = partialVerifyResponse.data.record;
    assertEqual(
      record.name,
      updates.name,
      "Name unchanged after partial update",
    );
    assertEqual(
      record.value,
      partialUpdate.value,
      "Value changed after partial update",
    );
  }

  // Test update on non-existent record
  const nonExistentId = 999999;
  log(`Testing update on non-existent record ID: ${nonExistentId}`);
  const notFoundResponse = await makeRequest(
    "PUT",
    `/api/records/${nonExistentId}`,
    updates,
  );

  assertEqual(notFoundResponse.status, 404, "Non-existent update status");
  assertEqual(
    notFoundResponse.data.success,
    false,
    "Non-existent update success flag",
  );
}

async function testDeleteRecord() {
  log("Testing DELETE operation", "title");

  if (!createdRecordId) {
    log("No record ID available for delete test", "warn");
    return;
  }

  // Test valid deletion
  log(`Deleting record with ID: ${createdRecordId}`);
  const deleteResponse = await makeRequest(
    "DELETE",
    `/api/records/${createdRecordId}`,
  );

  assertEqual(deleteResponse.status, 200, "Delete response status");
  assertEqual(deleteResponse.data.success, true, "Delete success flag");

  // Verify record is gone
  log("Verifying record was deleted");
  const verifyResponse = await makeRequest(
    "GET",
    `/api/records/${createdRecordId}`,
  );

  assertEqual(verifyResponse.status, 404, "Record should be gone");
  assertEqual(
    verifyResponse.data.success,
    false,
    "Deleted record success flag",
  );

  // Test delete on non-existent record
  const nonExistentId = 999999;
  log(`Testing delete on non-existent record ID: ${nonExistentId}`);
  const notFoundResponse = await makeRequest(
    "DELETE",
    `/api/records/${nonExistentId}`,
  );

  assertEqual(notFoundResponse.status, 404, "Non-existent delete status");
  assertEqual(
    notFoundResponse.data.success,
    false,
    "Non-existent delete success flag",
  );
}

async function testExtraFunctionality() {
  log("Testing additional API functionality", "title");

  // Test generate records endpoint
  log("Testing /api/generate endpoint");
  const generateResponse = await makeRequest("POST", "/api/generate", {
    count: 5,
  });

  assertEqual(generateResponse.status, 200, "Generate response status");
  assertEqual(generateResponse.data.success, true, "Generate success flag");
  assertEqual(generateResponse.data.count, 5, "Generated record count");

  // Test database size endpoint
  log("Testing /api/db-size endpoint");
  const sizeResponse = await makeRequest("GET", "/api/db-size");

  assertEqual(sizeResponse.status, 200, "DB size response status");
  assertEqual(sizeResponse.data.success, true, "DB size success flag");

  if (sizeResponse.data.size) {
    log(`Current database size: ${sizeResponse.data.size} bytes`, "success");
  }
}

// Main function to run all tests
async function runTests() {
  log("Starting DORM API tests on " + API_BASE, "title");

  try {
    // Check if API is reachable
    log("Checking if API is available...");
    try {
      await makeRequest("GET", "/api/db-size");
      log("API is online and responding", "success");
    } catch (error) {
      log(`API not available at ${API_BASE}. Is the server running?`, "error");
      log(`Error: ${error.message}`, "error");
      process.exit(1);
    }

    // Run all test suites
    await testCreateRecord();
    await testReadRecords();
    await testUpdateRecord();
    await testDeleteRecord();
    await testExtraFunctionality();

    log("\nAll tests completed!", "title");
  } catch (error) {
    log(`Test execution error: ${error.stack}`, "error");
  }
}

// Run the tests
runTests();
