const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
require("dotenv").config();
const OpenAI = require("openai");

const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./chat.db");

db.run(`CREATE TABLE IF NOT EXISTS chat(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_message TEXT,
  assistant_response TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// frage endpunkt
app.post("/", async (req, res) => {
  try {
    const userMessage =
      req.body.message || "Hello, I didn't write a question yet!";

    // Check, ob die Frage bereits in der Datenbank steht
    db.get(
      "SELECT assistant_response FROM chat WHERE user_message = ?",
      [userMessage],
      async (error, row) => {
        if (error) {
          console.error(error);
          return res.status(500).json({ error: "Database error" });
        }
        if (row) {
          return res.status(200).json({
            success: true,
            data: row.assistant_response,
            cached: true,
          });
        } else {
          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: req.body.message || "Hello" }],
            max_tokens: 50,
            temperature: 0,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
          });

          const assistantResponse = response.choices[0].message.content;

          db.run(
            "INSERT INTO chat (user_message, assistant_response) VALUES (?, ?)",
            [userMessage, assistantResponse]
          );

          return res.status(200).json({
            success: true,
            data: assistantResponse,
            cached: false,
          });
        }
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Somethign went wrong" });
  }
});

// history endpunkt
app.get("/history", (req, res) => {
  const history = db.all(
    `SELECT user_message, assistant_response FROM chat`,
    [],
    (error, rows) => {
      if (error) {
        console.error(error);
        return res.status(500).json({ error: "Database error" });
      }
      res.json({
        success: true,
        message: rows,
      });
    }
  );
});

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.use((req, res, next) => {
  console.log(`${req.method} request for ${req.url}`);
  next();
});

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

server.listen(port, () => {
  console.log(`Server is running at ${port}`);
});
