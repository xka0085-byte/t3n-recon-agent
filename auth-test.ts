// Verify which DID the AGENT_KEY binds to (bypasses CLI caching).
import { connectSession } from "./src/t3n.js";

const keyName = process.argv[2] ?? "AGENT_KEY";
const { did } = await connectSession(keyName);
console.log(`${keyName} -> ${did}`);
