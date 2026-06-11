FROM node:22-alpine

# git is required to clone the SDK at build time
RUN apk add --no-cache git

# Clone the Bevo Agent SDK to the path the relative import resolves to:
#   import "../../bevo-agent-sdk/src/index.js" from /app/src → /bevo-agent-sdk/src
WORKDIR /bevo-agent-sdk
RUN git clone https://github.com/crayscrays/bevo-agent-sdk.git .

# Install and run the testbot
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

EXPOSE 3001
CMD ["npm", "start"]
