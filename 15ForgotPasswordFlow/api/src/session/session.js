import { client } from "../db.js"

export const session = client.db("test").collection("session")

session.createIndex({ sessionToken: 1 })
