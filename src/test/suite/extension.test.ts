import * as assert from 'assert';
import * as vscode from 'vscode';

// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Sample test', async () => {
    await vscode.commands.executeCommand('tailscale-serve-view.focus');
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    // sleep for 5 seconds
    await new Promise((resolve) => setTimeout(resolve, 5000));
  });
});
