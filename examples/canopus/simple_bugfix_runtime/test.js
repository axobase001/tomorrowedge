import assert from "node:assert/strict";
import { add } from "./index.js";

assert.equal(add(2, 3), 5);
console.log("unit test passed");
