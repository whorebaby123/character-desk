import handler from "vinext/server/app-router-entry";

// All persistence is browser-local; only the AI proxy runs on the Worker.
export default handler;
