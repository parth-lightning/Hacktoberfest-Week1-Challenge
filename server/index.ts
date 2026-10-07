import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const maxNameLength = 100;
const maxEmailLength = 254;
const maxMessageLength = 5000;

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.post("/api/contact", (request, response) => {
  const { name, email, message } = request.body ?? {};

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof message !== "string"
  ) {
    response.status(400).json({ error: "Please complete all fields." });
    return;
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim();
  const cleanMessage = message.trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);

  if (
    !cleanName ||
    cleanName.length > maxNameLength ||
    cleanEmail.length > maxEmailLength ||
    !validEmail ||
    !cleanMessage ||
    cleanMessage.length > maxMessageLength
  ) {
    response.status(400).json({
      error: "Check your name, email, and message, then try again.",
    });
    return;
  }

  response.status(202).json({
    message:
      "Thanks for reaching out. This starter does not store or send messages yet.",
  });
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    next: express.NextFunction,
  ) => {
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({ error: "The request body must be valid JSON." });
      return;
    }
    if (
      error instanceof Error &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      response.status(413).json({ error: "The request is too large." });
      return;
    }
    next(error);
  },
);

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
