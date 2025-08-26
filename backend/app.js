const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
require("dotenv").config();
const OpenAI = require("openai");
const { ChatOpenAI } = require("@langchain/openai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { tool } = require("@langchain/core/tools");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { MessagesPlaceholder } = require("@langchain/core/prompts");
const { createOpenAIToolsAgent, AgentExecutor } = require("langchain/agents");
const { z } = require("zod");

const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./chat.db");

db.run(`CREATE TABLE IF NOT EXISTS chat(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_message TEXT,
  assistant_response TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

db.run(`CREATE TABLE IF NOT EXISTS products(
  product_id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT,
  stock INTEGER,
  price REAL
)`);

db.run(`CREATE TABLE IF NOT EXISTS customers(
  customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT,
  city TEXT
)`);

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Tool-Funktion für sichere SQL-SELECT-Queries
async function executeReadOnlyQuery(sqlQuery) {
  if (!sqlQuery.toLowerCase().trim().startsWith("select")) {
    return "Error: Only read-only SELECT queries are permitted.";
  }
  console.log("SQL-Tool wurde aufgerufen mit:", sqlQuery);
  return new Promise((resolve, reject) => {
    db.all(sqlQuery, [], (err, rows) => {
      if (err) {
        resolve(`Database Error: ${err.message}`);
      } else {
        resolve(JSON.stringify(rows));
      }
    });
  });
}

// Tool-Wrapper für LangChain
const dbQueryTool = tool(
  async ({ query }) => {
    return await executeReadOnlyQuery(query);
  },
  {
    name: "query_sql_database",
    description: `Use this tool to retrieve information about products, users, or orders. 
      The input MUST be a single, valid SQL SELECT query. 
      Example input: SELECT COUNT(*) FROM products WHERE stock < 10;`,
    schema: z.object({
      query: z
        .string()
        .describe("A valid SQL SELECT query to run against the database."),
    }),
  }
);

// Example System Prompt Content
const systemPromptContent = `
You are a helpful assistant and a SQL expert. Your task is to answer user questions based on the available data.

RULES:
1. You MUST use the 'query_sql_database' tool for all data-related questions.
2. Always write out the SQL query in your thought process before calling the tool.
3. Only use read-only SELECT statements.

DATABASE SCHEMA:
--
-- Table: 'products'
-- Columns: 'product_id' (INT), 'product_name' (TEXT), 'stock' (INT), 'price' (REAL)
--
-- Table: 'customers'
-- Columns: 'customer_id' (INT), 'first_name' (TEXT), 'city' (TEXT)
--
`;

// langchain settings
const chatModel = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-3.5-turbo",
  temperature: 0,
  streaming: false,
  verbose: true,
});

const simpleChatPrompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
]);

// Agent-Prompt (mit agent_scratchpad)
const agentChatPrompt = ChatPromptTemplate.fromMessages([
  ["system", systemPromptContent],
  ["human", "{input}"],
  new MessagesPlaceholder("agent_scratchpad"),
]);

const tools = [dbQueryTool];

async function setupAgent() {
  const agent = await createOpenAIToolsAgent({
    llm: chatModel,
    tools: tools,
    prompt: agentChatPrompt,
  });

  const agentExecutor = new AgentExecutor({
    agent: agent,
    tools: tools,
    verbose: true,
    maxIterations: 3,
  });

  return agentExecutor;
}

// agent mode
app.post("/agent", async (req, res) => {
  try {
    console.log("=== AGENT REQUEST START ===");
    const userMessage =
      req.body.message || "Hello, I didn't write a question yet!";
    console.log("User message:", userMessage);
    const agentExecutor = await setupAgent();

    const result = await agentExecutor.invoke({
      input: userMessage,
    });

    console.log("=== AGENT RESULT ===");
    console.log(JSON.stringify(result, null, 2));
    console.log("=== AGENT REQUEST END ===");
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("=== AGENT ERROR ===");
    console.error(error);
    res.status(500).json({ error: "Agent error", details: error.message });
  }
});

app.post("/test-tool", async (req, res) => {
  try {
    console.log("Testing SQL tool directly...");
    const result = await dbQueryTool.invoke({
      query: "SELECT * FROM customers WHERE city = 'Berlin'",
    });
    console.log("Tool result:", result);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Tool error:", error);
    res.status(500).json({ error: "Tool test error" });
  }
});

// questions
app.post("/", async (req, res) => {
  try {
    const userMessage =
      req.body.message || "Hello, I didn't write a question yet!";

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
          const chain = simpleChatPrompt.pipe(chatModel);
          const response = await chain.invoke({ input: userMessage });

          const assistantResponse = response.content;

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

// streaming
app.post("/stream", async (req, res) => {
  try {
    const userMessage =
      req.body.message || "Hello, I didn't write a question yet!";

    let assistantResponse = "";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const prompt = await simpleChatPrompt.format({ input: userMessage });
    const stream = await chatModel.stream(prompt);

    for await (const chunk of stream) {
      if (chunk.content) {
        assistantResponse += chunk.content;
        res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }
    }

    db.run(
      "INSERT INTO chat (user_message, assistant_response) VALUES (?, ?)",
      [userMessage, assistantResponse]
    );

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error(error);
    res.end();
  }
});

// history
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
        history: rows,
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
