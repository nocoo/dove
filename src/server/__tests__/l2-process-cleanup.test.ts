import { spawn } from "node:child_process";
import { expect, test } from "vitest";
import { stopOwnedProcessGroup } from "../../../scripts/l2-isolation";

test("waits for a stubborn descendant after the process-group leader exits", async () => {
	const childScript =
		"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)";
	const parentScript = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:['ignore','pipe','inherit']});child.stdout.once('data',()=>process.stdout.write(String(child.pid)+'\\n'));setInterval(()=>{},1000);`;
	const parent = spawn(process.execPath, ["-e", parentScript], {
		detached: true,
		stdio: ["ignore", "pipe", "inherit"],
	});
	let cleanupError: unknown;
	try {
		const descendant = await new Promise<number>((accept, reject) => {
			parent.once("error", reject);
			parent.stdout.once("data", (value: Buffer) => accept(Number(value.toString().trim())));
		});
		expect(Number.isSafeInteger(descendant)).toBe(true);
		await stopOwnedProcessGroup(parent);
		expect(() => process.kill(descendant, 0)).toThrow();
	} finally {
		if (parent.pid) {
			try {
				process.kill(-parent.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") cleanupError = error;
			}
		}
	}
	expect(cleanupError).toBeUndefined();
}, 10_000);
