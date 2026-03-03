FROM node:18-alpine AS builder

# Install git (needed to clone private GitHub package deps)
RUN apk add --no-cache git

WORKDIR /app

# Configure npm to authenticate with GitHub for private repos
# GH_TOKEN is passed as a build arg from Railway env vars
ARG GH_TOKEN
RUN echo "//github.com/:_authToken=${GH_TOKEN}" > .npmrc && \
    echo "@rive-scientific:registry=https://npm.pkg.github.com" >> .npmrc && \
    echo "@rive:registry=https://npm.pkg.github.com" >> .npmrc && \
    git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Production stage (no token, no git, no source code) ──
FROM node:18-alpine

RUN apk add --no-cache git

WORKDIR /app

ARG GH_TOKEN
RUN git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"

COPY package*.json ./
RUN npm install --omit=dev && \
    rm -f .npmrc && \
    git config --global --remove-section url."https://${GH_TOKEN}@github.com/"

COPY --from=builder /app/dist ./dist

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
