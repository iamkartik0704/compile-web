# building the react app since we dont get react officially
FROM node:20-alpine AS builder
WORKDIR /app
# Install Python and build tools for native dependencies (node-gyp)
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm install

#copying src code
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV NODE_OPTIONS="--max-old-space-size=4096"
#RUN npm run build
RUN npx vite build src/renderer
#serving the web server
FROM nginx:alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/src/renderer/dist /usr/share/nginx/html
EXPOSE 80
# tells nginx to run in foreground and not background
CMD ["nginx", "-g" , "daemon off;"]
