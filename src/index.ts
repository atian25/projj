#!/usr/bin/env bun
import { createCli } from "./cli";
import { consoleOutput } from "./output";

const cli = createCli(consoleOutput);
const code = await cli.run(process.argv.slice(2));
process.exit(code);
