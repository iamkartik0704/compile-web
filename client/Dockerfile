# building the react app since we dont get react officially
FROM node:20-alpine AS builder
WORKDIR /app
# Install Python and build tools for native dependencies (node-gyp)
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm install

#copying src code
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=4096"
#RUN npm run build
RUN npx vite build -c vite.config.js
#serving the web server
FROM nginx:alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/src/renderer/dist /usr/share/nginx/html
EXPOSE 80
# tells nginx to run in foreground and not background
CMD ["nginx", "-g" , "daemon off;"]
