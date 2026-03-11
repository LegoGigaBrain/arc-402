import * as fs from "fs";
import { ethers } from "ethers";

/**
 * Compute keccak256 of a file's raw bytes.
 */
export function hashFile(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return ethers.keccak256(data);
}

/**
 * Compute keccak256 of a string.
 */
export function hashString(str: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}
