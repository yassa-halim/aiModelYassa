// scripts/setup.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Project Setup...\n');

/* ===============================
   🔧 Helpers
   =============================== */

const runCommand = (cmd, args = [], message) => {
    return new Promise((resolve, reject) => {
        console.log(`👉 ${message}...`);

        const child = spawn(cmd, args, {
            stdio: 'inherit',
            shell: true
        });

        child.on('error', (err) => {
            reject(`❌ Failed to run ${cmd}: ${err.message}`);
        });

        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(`❌ ${cmd} exited with code ${code}`);
        });
    });
};

const ensureDir = (dirPath, label) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`✅ ${label} directory created.`);
    } else {
        console.log(`✔️ ${label} directory already exists.`);
    }
};

const commandExists = (command) => {
    return new Promise((resolve) => {
        const check = spawn(command, ['--version'], {
            stdio: 'ignore',
            shell: true
        });
        check.on('close', (code) => resolve(code === 0));
    });
};

/* ===============================
   🚀 Setup Process
   =============================== */

const setup = async () => {
    try {
        /* ===============================
           1️⃣ Check Node Dependencies
           =============================== */
        if (!fs.existsSync(path.join(__dirname, '../node_modules'))) {
            await runCommand('npm', ['install'], 'Installing npm dependencies');
        } else {
            console.log('✔️ node_modules already installed. Skipping npm install.');
        }

        /* ===============================
           2️⃣ Ensure Required Directories
           =============================== */
        ensureDir(path.join(__dirname, '../ai_PDF'), 'ai_PDF');
        ensureDir(path.join(__dirname, '../reports'), 'reports');

        /* ===============================
           3️⃣ Check Ollama Availability
           =============================== */
        console.log('\n⏳ Checking Ollama installation...');
        const ollamaInstalled = await commandExists('ollama');

        if (!ollamaInstalled) {
            throw new Error(
                'Ollama is not installed or not available in PATH.\n' +
                '👉 Install from: https://ollama.com'
            );
        }

        /* ===============================
           4️⃣ Ensure Required Model
           =============================== */
        console.log('\n🧠 Checking LLaMA 3.1 (8B Instruct Q4_0) model...');
        const listProcess = spawn('ollama', ['list'], {
            stdio: 'pipe',
            shell: true
        });

        let listOutput = '';
        listProcess.stdout.on('data', (d) => {
            listOutput += d.toString();
        });

        await new Promise((res) => listProcess.on('close', res));

        if (listOutput.includes('llama3.1:8b-instruct-q4_0')) {
            console.log('✔️ Model already installed. Skipping download.');
        } else {
            await runCommand(
                'ollama',
                ['pull', 'llama3.1:8b-instruct-q4_0'],
                'Pulling AI model'
            );
        }

        /* ===============================
           5️⃣ Cleanup Old Model (Soft)
           =============================== */
        console.log('\n🧹 Cleaning old generic model (if exists)...');
        try {
            await runCommand(
                'ollama',
                ['rm', 'llama3.1'],
                'Removing old model'
            );
        } catch {
            console.log('⚠️ Old model not found or already removed.');
        }

        console.log('\n🎉 Setup Completed Successfully!');
        console.log('👉 Run: npm start');

    } catch (error) {
        console.error('\n💥 Setup Failed:\n', error);
        process.exit(1);
    }
};

setup();
