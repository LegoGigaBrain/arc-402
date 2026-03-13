import * as fs from "fs";
import { ethers } from "ethers";

export const hashFile = (filePath: string) => ethers.keccak256(fs.readFileSync(filePath));
export const hashString = (value: string) => ethers.keccak256(ethers.toUtf8Bytes(value));
