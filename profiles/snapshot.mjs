import { exec } from 'child_process';
import fs from 'fs';

function executeCommand(command) {
  const fullCommand = `tailscale ${command} --json`;
  return new Promise((resolve, reject) => {
    exec(fullCommand, (error, stdout, stderr) => {
      if (error) {
        // If command not found in PATH, try with zsh
        if (error.code === 127) {
          exec(`zsh -i -c "${fullCommand}"`, (zshError, zshStdout, zshStderr) => {
            if (zshError) {
              reject(zshError);
            } else {
              resolve(JSON.parse(zshStdout.trim()));
            }
          });
        } else {
          reject(error);
        }
      } else {
        try {
          const parsedOutput = JSON.parse(stdout.trim());
          resolve(parsedOutput);
        } catch (parseError) {
          resolve({});
        }
      }
    });
  });
}

function exportResults(profileName, results) {
  const filename = `${profileName}.json`;
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  console.log(`Results exported to ${filename}`);
}

async function runCommands(profileName) {
  try {
    const results = {};

    results.Status = await executeCommand('status');
    results.ServeConfig = await executeCommand('serve status');

    // Export results to JSON file
    exportResults(profileName, results);
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  }
}

const profileName = process.argv[2];

if (profileName) {
  runCommands(profileName);
} else {
  console.error('Please provide a profile name as an argument.');
}
