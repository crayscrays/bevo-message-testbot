FROM node:22-alpine

# git is required to install the GitHub-hosted npm package
RUN apk add --no-cache git

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

EXPOSE 3001
CMD ["npm", "start"]
