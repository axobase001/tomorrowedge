import { strictEqual } from "node:assert";
import { transition } from "./machine.js";

strictEqual(transition("idle", "start"), "running");
strictEqual(transition("running", "finish"), "done");
strictEqual(transition("running", "fail"), "failed");
strictEqual(transition("failed", "retry"), "running");

console.log("ok");
