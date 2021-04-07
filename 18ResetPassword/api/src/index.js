import "./env.js"
import { fastify } from "fastify"
import fastifyStatic from "fastify-static"
import fastifyCookie from "fastify-cookie"
import fastifyCors from "fastify-cors"
import path from "path"
import { fileURLToPath } from "url"
import { connectDb } from "./db.js"
import { registerUser } from "./accounts/register.js"
import { authorizeUser } from "./accounts/authorize.js"
import { logUserIn } from "./accounts/logUserIn.js"
import { logUserOut } from "./accounts/logUserOut.js"
import { getUserFromCookies, changePassword } from "./accounts/user.js"
import { sendEmail, mailInit } from "./mail/index.js"
import {
  createVerifyEmailLink,
  validateVerifyEmail,
} from "./accounts/verify.js"
import { createResetLink, validateResetEmail } from "./accounts/reset.js"

// ESM specific features
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = fastify()

async function startApp() {
  try {
    await mailInit()

    app.register(fastifyCors, {
      origin: [/\.nodeauth.dev/, "https://nodeauth.dev", "localhost"],
      credentials: true,
    })

    app.register(fastifyCookie, {
      secret: process.env.COOKIE_SIGNATURE,
    })

    app.register(fastifyStatic, {
      root: path.join(__dirname, "public"),
    })

    app.post("/api/register", {}, async (request, reply) => {
      try {
        const userId = await registerUser(
          request.body.email,
          request.body.password
        )
        // If account creations was successful
        if (userId) {
          const emailLink = await createVerifyEmailLink(request.body.email)
          await sendEmail({
            to: request.body.email,
            subject: "Verify your email",
            html: `<a href="${emailLink}">verify</a>`,
          })

          await logUserIn(userId, request, reply)
          reply.send({
            data: {
              status: "SUCCESS",
              userId,
            },
          })
        }
      } catch (e) {
        console.error(e)
        reply.send({
          data: {
            status: "FAILED",
            userId,
          },
        })
      }
    })

    app.post("/api/authorize", {}, async (request, reply) => {
      try {
        const { isAuthorized, userId } = await authorizeUser(
          request.body.email,
          request.body.password
        )
        console.log("isAuthorized, userId", isAuthorized, userId)
        if (isAuthorized) {
          await logUserIn(userId, request, reply)
          reply.send({
            data: {
              status: "SUCCESS",
              userId,
            },
          })
        }
      } catch (e) {
        console.error(e)
        reply.send({
          data: {
            status: "FAILED",
            userId,
          },
        })
      }
    })

    app.post("/api/logout", {}, async (request, reply) => {
      try {
        await logUserOut(request, reply)
        reply.send({
          data: {
            status: "SUCCESS",
          },
        })
      } catch (e) {
        console.error(e)
        reply.send({
          data: {
            status: "FAILED",
            userId,
          },
        })
      }
    })

    app.post("/api/change-password", {}, async (request, reply) => {
      try {
        const { oldPassword, newPassword } = request.body
        // Verify user login
        const user = await getUserFromCookies(request, reply)
        if (user?.email?.address) {
          // Compare current logged in user with form to re-auth
          const { isAuthorized, userId } = await authorizeUser(
            user.email.address,
            oldPassword
          )
          console.log("isAuthorized, userId", isAuthorized, userId)
          // If user is who they say they are
          if (isAuthorized) {
            // Update password in db
            await changePassword(userId, newPassword)
            return reply.code(200).send("All Good")
          }
        }
        return reply.code(401).send()
      } catch (e) {
        console.error(e)
        return reply.code(401).send()
      }
    })

    app.post("/api/forgot-password", {}, async (request, reply) => {
      try {
        const { email } = request.body
        const link = await createResetLink(email)
        // Send email with link
        if (link) {
          await sendEmail({
            to: email,
            subject: "Reset your password",
            html: `<a href="${link}">Reset</a>`,
          })
        }

        return reply.code(200).send()
      } catch (e) {
        console.error(e)
        return reply.code(401).send()
      }
    })

    app.post("/api/reset", {}, async (request, reply) => {
      try {
        const { email, password, token, time } = request.body
        const isValid = await validateResetEmail(token, email, time)
        if (isValid) {
          // Find User
          const { user } = await import("./user/user.js")
          const foundUser = await user.findOne({
            "email.address": email,
          })
          console.log("foundUser", foundUser, password)
          // Change password
          if (foundUser._id) {
            await changePassword(foundUser._id, password)
            return reply.code(200).send("Password Updated")
          }
        }

        return reply.code(401).send("Reset failed")
      } catch (e) {
        console.error(e)
        return reply.code(401).send()
      }
    })

    app.post("/api/verify", {}, async (request, reply) => {
      try {
        const { token, email } = request.body
        const isValid = await validateVerifyEmail(token, email)
        if (isValid) {
          return reply.code(200).send()
        }
        return reply.code(401).send()
      } catch (e) {
        console.error(e)
        return reply.code(401).send()
      }
    })

    app.get("/test", {}, async (request, reply) => {
      try {
        // Verify user login
        const user = await getUserFromCookies(request, reply)
        // Return user email, if it exists, otherwise return unauthorized
        if (user?._id) {
          reply.send({
            data: user,
          })
        } else {
          reply.send({
            data: "User Lookup Failed",
          })
        }
      } catch (e) {
        throw new Error(e)
      }
    })

    await app.listen(3000)
    console.log("🚀 Server Listening at port: 3000")
  } catch (e) {
    console.error(e)
  }
}

connectDb().then(() => {
  startApp()
})
