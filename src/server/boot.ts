import { startServer, type ServerKernel } from "@typetorch/framework";
import { BUILD } from "../shared/build";

/** Called by the kernel's Entry script for every server generation. Returns the soft-stop function. */
export function boot(kernel: ServerKernel) {
	return startServer(kernel, { modules: [script.Parent!.FindFirstChild("services")!], build: BUILD });
}
