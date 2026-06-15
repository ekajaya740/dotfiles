# Pi Notify++

A powerful notification extension for the [Pi Coding Agent](https://github.com/mariozechner/pi-coding-agent).

Pi Notify++ sends native terminal notifications when the agent completes a turn, providing rich, at-a-glance context about what just happened without needing to switch tabs.

## Features

- **Smart Status**: Instantly see if the turn succeeded (✅), failed (❌), or was truncated due to length (⚠️).
- **Time-Aware**: Displays duration only for long-running tasks (>1m), keeping short interactions clean.
- **Contextual Metadata**:
  - **Tool Stats**: See how many tools were used (`5 ops`).
  - **Last Action**: Visual indicators for commands (`💻 npm install`) vs file edits (`📝 server.ts`).
  - **Error Tracking**: Identifies which tool failed directly in the notification.
- **Optimized Layout**: Critical stats are placed at the *start* of the message body to ensure they are never truncated by the OS notification center.
- **Clean Aesthetics**: Automatically formats model names (e.g., `Gemini 3 Pro`) and durations (`1h 5m`) for maximum readability.

## Requirements

- **Pi Coding Agent**
- A terminal that supports **OSC 777** notifications:
  - [Ghostty](https://ghostty.org/) (Recommended)
  - iTerm2
  - rxvt-unicode
  - Kitty (with configuration)

## Installation

### Option 1: Git Clone (Recommended)

Clone this repository directly into your Pi extensions directory:

```bash
# Create the directory if it doesn't exist
mkdir -p ~/.pi/agent/extensions

# Clone the repo
git clone https://github.com/YOUR_USERNAME/pi-notify-pp.git ~/.pi/agent/extensions/pi-notify-pp
```

Pi will automatically discover `index.ts` in the `pi-notify-pp` folder.

### Option 2: Manual Copy

1. Download `index.ts`.
2. Place it in `~/.pi/agent/extensions/pi-notify-pp/index.ts` (or simply as `~/.pi/agent/extensions/pi-notify.ts` for a single-file install).

## Usage

Just run `pi` as usual. When the agent finishes processing and is waiting for your input, you will receive a system notification.

![Pi Notify++ Screenshot](./pi-notify++.png)

### Notification Guide

The notification is packed with info, optimized for at-a-glance reading:

**1. The Title**
`✅ (3m) Pi: Gemini 3 Pro`

- **Status Icon**:
  - ✅ **Success**: Everything ran smoothly.
  - ❌ **Error**: A tool execution failed (e.g., build error).
  - ⚠️ **Truncated**: The model's response was cut off (token limit reached).
- **Duration**: Shows how long the turn took, but **only if it exceeds 1 minute**. Short turns remain minimal.
- **Model Name**: Automatically cleaned up to be short and readable (e.g., `Gemini 3 Pro H`).

**2. The Body**
`[12 ops · 💻 npm test · bash ❌] The tests failed...`

- **Metadata Block** (Always at the start):
  - **Tool Count**: Number of tool calls (`12 ops`).
  - **Last Action**: Visual icon for the final operation:
    - 💻 `Command`: Terminal execution.
    - 📝 `File`: File write or edit.
  - **Error Details**: If a tool fails, it explicitly names it (e.g., `bash ❌`).
  - **Session Name**: Your named session (e.g., `[fixing-bug]`).
- **Snippet**: A preview of the agent's final response.

- **Clicking** the notification brings the terminal to the foreground.

## Customization

The extension is a simple TypeScript file. Feel free to edit `index.ts` to change icons, timeout thresholds, or formatting preferences.
