import * as net from "net"

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address && typeof address === "object") {
        server.close(() => resolve(address.port))
      } else {
        server.close(() => reject(new Error("Could not find free port")))
      }
    })
  })
}


