import { startClient, type ClientKernel } from "@typetorch/framework";
import { BUILD } from "../shared/build";

/** Called by the kernel's ClientEntry script for every client generation. Returns the soft-stop function. */
export function boot(kernel: ClientKernel) {
	return startClient(kernel, { modules: [script.Parent!.FindFirstChild("controllers")!], build: BUILD });
}
