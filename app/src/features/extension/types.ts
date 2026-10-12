// What the window and the app say to each other about the browser extension's
// door: the switch, the port, the extensions paired and the code waiting. The
// app's commands are in src-tauri/src/extension. A token never comes this way:
// only its owner, the extension, is ever given it.

/** A paired extension, as Settings lists it. */
export interface PairedExtension {
  id: string;
  /** What the extension called itself ("Edge", "Chrome"). */
  label: string;
  /** `chrome-extension://<id>`: where its requests come from. */
  origin: string;
  /** When it paired, in milliseconds since the Unix epoch. */
  pairedAt: number;
}

/** The code waiting to be typed into the extension. */
export interface PairingCode {
  code: string;
  /** How long it has left, when the app said so. */
  secondsLeft: number;
  triesLeft: number;
}

export interface ExtensionStatus {
  /** The switch in Settings. */
  enabled: boolean;
  /** The port the door listens on (or will, when it is on). */
  port: number;
  /** The door is open now (it is not when the port is taken). */
  running: boolean;
  /** Why the door could not open. */
  problem: string | null;
  paired: PairedExtension[];
  pairing: PairingCode | null;
}

/** How the window reaches the door's settings: the app's commands, or a stand-in. */
export interface ExtensionBackend {
  /** Whether there is a door to switch (the desktop app only). */
  readonly available: boolean;
  status(): Promise<ExtensionStatus>;
  setEnabled(on: boolean): Promise<ExtensionStatus>;
  setPort(port: number): Promise<ExtensionStatus>;
  pairStart(): Promise<ExtensionStatus>;
  pairCancel(): Promise<ExtensionStatus>;
  revoke(id: string): Promise<ExtensionStatus>;
}

export const DEFAULT_PORT = 7434;
