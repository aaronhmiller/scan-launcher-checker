import { load } from "https://deno.land/std/dotenv/mod.ts";

// Define types for our GraphQL responses
interface ScanAllResponse {
  data: {
    scanAll: {
      scanID: string;
    };
  };
}

interface GetScannedAppsResponse {
  data: {
    getScannedAppsInfo: {
      isStillScanning: boolean;
    } | null;
  };
}

interface CheckScanInProgressResponse {
  data: {
    checkScanInProgress: {
      isInProgress: boolean;
    };
  };
}

// Load environment variables from .env file
const env = await load({ export: true });

// GraphQL endpoint and API key from environment variables (or default)
const GRAPHQL_ENDPOINT = Deno.env.get("GRAPHQL_ENDPOINT") || "https://api.cloud.ox.security/api/apollo-gateway"; //from env or use default
const API_KEY = Deno.env.get("API_KEY");

// Function to check if a scan is currently in progress
async function checkScanInProgress(): Promise<boolean> {
  const query = `
    query CheckScanInProgress {
      checkScanInProgress {
        isInProgress
      }
    }
  `;

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": API_KEY,
      },
      body: JSON.stringify({
        query: query,
        variables: {},
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: CheckScanInProgressResponse = await response.json();
    const isInProgress = data.data?.checkScanInProgress?.isInProgress;
    
    console.log(`Scan in progress check: ${isInProgress ? "A scan is currently running" : "No scan currently running"}`);
    return isInProgress;
  } catch (error) {
    console.error(`Error checking if scan is in progress: ${error}`);
    // If we can't determine if a scan is in progress, return true as a safety measure
    return true;
  }
}

// Function to initiate a scan and get a scanID
async function initiateScanning(): Promise<string> {
  const scanMutation = `
    mutation Mutation {
      scanAll {
        scanID
      }
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": API_KEY,
    },
    body: JSON.stringify({
      query: scanMutation,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data: ScanAllResponse = await response.json();
  
  if (!data.data?.scanAll?.scanID) {
    throw new Error("Failed to get scanID from the response");
  }

  console.log(`Scan initiated with scanID: ${data.data.scanAll.scanID}`);
  return data.data.scanAll.scanID;
}

// Modified checkScanningStatus to include more detailed state information
async function checkScanningStatus(scanID: string): Promise<{ isStillScanning: boolean | null, error?: string }> {
  const statusQuery = `
    query IsStillScanning($getScanInfoInput: ScanInfoInput) {
      getScannedAppsInfo(getScanInfoInput: $getScanInfoInput) {
        isStillScanning
      }
    }
  `;

  const variables = {
    getScanInfoInput: {
      scanID: scanID,
    },
  };

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": API_KEY,
      },
      body: JSON.stringify({
        query: statusQuery,
        variables: variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: GetScannedAppsResponse = await response.json();
    
    // Return the status result
    return {
      isStillScanning: data.data.getScannedAppsInfo?.isStillScanning ?? null
    };
  } catch (error) {
    console.error(`Error in checkScanningStatus: ${error}`);
    return {
      isStillScanning: null,
      error: error.message
    };
  }
}

// Modified polling function to differentiate between not-started and cancelled states
async function pollUntilScanComplete(
  scanID: string, 
  maxAttempts = Number(Deno.env.get("MAX_POLL_ATTEMPTS")) || 100,
  intervalMs = Number(Deno.env.get("POLL_INTERVAL_MS")) || 30000, //30 seconds between polls
  initializationTimeoutMs = Number(Deno.env.get("INITIALIZATION_TIMEOUT_MS")) || 300000 // 5 minutes (5*60*1000) for initialization
): Promise<{ success: boolean, status: string }> {
  console.log(`Polling every ${intervalMs / 1000} seconds until scan completion for scanID: ${scanID}`);
  
  let attempts = 0;
  let consecutiveNullResponses = 0;
  const maxConsecutiveNullResponses = Math.ceil(initializationTimeoutMs / intervalMs);
  let scanStarted = false;
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`Poll attempt ${attempts}/${maxAttempts}`);
    
    const statusResult = await checkScanningStatus(scanID);
    
    // If we got a null response
    if (statusResult.isStillScanning === null) {
      consecutiveNullResponses++;
      
      // If we previously detected the scan as started, a null now likely means cancellation
      if (scanStarted) {
        console.log("Scan appears to have been cancelled - previously running but now returning null");
        return { success: false, status: "cancelled" };
      }
      
      // If we've been getting null responses for too long, it might be stuck or cancelled before starting
      if (consecutiveNullResponses >= maxConsecutiveNullResponses) {
        console.log(`Scan initialization timeout after ${initializationTimeoutMs / 1000} seconds. Scan may have been cancelled externally before initialization completed.`);
        return { success: false, status: "initialization_timeout" };
      }
      
      console.log(`Scan initializing... (${consecutiveNullResponses}/${maxConsecutiveNullResponses} attempts with null response)`);
    } 
    // If isStillScanning is false, scan is complete
    else if (statusResult.isStillScanning === false) {
      console.log("Scan completed successfully!");
      return { success: true, status: "completed" };
    }
    // If isStillScanning is true, scan is in progress
    else {
      console.log("Scan in progress...");
      scanStarted = true;
      consecutiveNullResponses = 0; // Reset counter since we got a non-null response
    }
    
    // Wait before next attempt
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  return { success: false, status: "max_attempts_reached" };
}

// Updated main function to handle the more detailed status response
async function main() {
  try {
    // Step 1: Check if a scan is already in progress
    const scanInProgress = await checkScanInProgress();
    
    if (scanInProgress) {
      console.log("Cannot start a new scan because a scan is already in progress.");
      return;
    }
    
    // Step 2: Initiate scan and get scanID
    const scanID = await initiateScanning();
    
    // Step 3: Poll until scan is complete or a definitive state is reached
    const result = await pollUntilScanComplete(scanID);
    
    if (result.success) {
      console.log(`Process completed successfully with status: ${result.status}`);
    } else {
      console.log(`Process did not complete successfully. Status: ${result.status}`);
      
      // Take different actions based on status
      switch (result.status) {
        case "cancelled":
          console.log("The scan was cancelled externally after it was started. You may want to initiate a new scan.");
          break;
        case "initialization_timeout":
          console.log("The scan failed to initialize within the expected timeframe. Check resources or if an external process cancelled the scan.");
          break;
        case "max_attempts_reached":
          console.log("Maximum polling attempts reached. The scan may still be running but taking longer than expected. Increase MAX_POLL_ATTEMPTS if this occurs regularly.");
          break;
      }
    }
  } catch (error) {
    console.error(`Error in scanning process: ${error}`);
  }
}

// Run the program
main();