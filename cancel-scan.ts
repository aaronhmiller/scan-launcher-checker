// Import required Deno modules
import { readLines } from "https://deno.land/std/io/mod.ts";
import { load } from "https://deno.land/std/dotenv/mod.ts";

// Define types for GraphQL request and response
interface CancelScanInput {
  scanId: string;
}

interface GraphQLRequest {
  operationName: string;
  variables?: any;
  query: string;
}

interface CancelScanResult {
  isCanceled: boolean;
  error?: string;
  scanId: string;
  previousScanId?: string;
}

interface GraphQLResponse {
  data: {
    cancelScan?: CancelScanResult;
    checkScanInProgress?: {
      isInProgress: boolean;
    };
  };
}

// Load environment variables from .env file
const env = await load({ export: true });

// GraphQL endpoint and API key from environment variables (or default)
const GRAPHQL_ENDPOINT = Deno.env.get("GRAPHQL_ENDPOINT") ||
  "https://api.cloud.ox.security/api/apollo-gateway"; //from env or use default
const API_KEY = Deno.env.get("API_KEY");

// Function to check if a scan is in progress
async function checkScanInProgress(): Promise<boolean> {
  // Construct the GraphQL request
  const request: GraphQLRequest = {
    operationName: "CheckScanInProgress",
    query: `query CheckScanInProgress {
      checkScanInProgress {
        isInProgress
      }
    }`,
  };

  try {
    // Send the GraphQL request
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": API_KEY,
      },
      body: JSON.stringify(request),
    });

    // Parse the response
    const responseData = await response.json() as GraphQLResponse;

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    if (!responseData.data || !responseData.data.checkScanInProgress) {
      throw new Error("Invalid response format from GraphQL endpoint");
    }

    return responseData.data.checkScanInProgress.isInProgress;
  } catch (error) {
    console.error("Error checking if scan is in progress:", error);
    throw error;
  }
}

// Function to prompt user for scanId
async function promptForScanId(): Promise<string> {
  console.log("Please enter the scanId to cancel:");
  for await (const line of readLines(Deno.stdin)) {
    return line.trim();
  }
  throw new Error("Failed to read input");
}

// Function to execute the GraphQL mutation
async function cancelScan(scanId: string): Promise<CancelScanResult> {
  // Construct the GraphQL request
  const request: GraphQLRequest = {
    operationName: "CancelScan",
    variables: {
      cancelScanInput: {
        scanId: scanId,
      },
    },
    query: `mutation CancelScan($cancelScanInput: CancelScanInput) {
      cancelScan(cancelScanInput: $cancelScanInput) {
        isCanceled
        error
        scanId
        previousScanId
      }
    }`,
  };

  try {
    // Send the GraphQL request
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": API_KEY,
      },
      body: JSON.stringify(request),
    });

    // Parse the response
    const responseData = await response.json() as GraphQLResponse;

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    if (!responseData.data || !responseData.data.cancelScan) {
      throw new Error("Invalid response format from GraphQL endpoint");
    }

    return responseData.data.cancelScan;
  } catch (error) {
    console.error("Error cancelling scan:", error);
    throw error;
  }
}

// Main function to run the program
async function main() {
  try {
    console.log("=== Scan Cancellation Tool ===");

    // First, check if a scan is in progress
    console.log("Checking if a scan is currently in progress...");
    const isInProgress = await checkScanInProgress();

    if (!isInProgress) {
      console.log("ℹ️ No scan is currently in progress. Nothing to cancel.");
      Deno.exit(0);
    }

    console.log(
      "✅ A scan is currently in progress. Proceeding with cancellation.",
    );

    // Prompt for scanId
    const scanId = await promptForScanId();
    console.log(`Attempting to cancel scan with ID: ${scanId}`);

    // Execute the cancel scan mutation
    const result = await cancelScan(scanId);

    // Display the result based on different scenarios
    if (result.isCanceled) {
      if (result.error && result.error.includes("No active scan found in DB")) {
        console.log(`⚠️ No active scan found for ID: ${result.scanId}`);
        console.log(`The scan may have already completed or been cancelled.`);
      } else if (result.error && result.error.length > 0) {
        console.log(
          `⚠️ Scan marked as canceled but returned an error: ${result.error}`,
        );
        console.log(`Scan ID: ${result.scanId}`);
      } else {
        console.log(`✅ Successfully cancelled scan with ID: ${result.scanId}`);
      }

      if (result.previousScanId) {
        console.log(`Previous scan ID: ${result.previousScanId}`);
      }
    } else {
      console.log(
        `❌ Failed to cancel scan: ${result.error || "Unknown error"}`,
      );
    }
  } catch (error) {
    console.error("An error occurred:", error.message);
    Deno.exit(1);
  }
}

// Run the program
main();
