FROM node:20-alpine
WORKDIR /app

#install dependencies
COPY package*.json ./
RUN npm install
#copying the server code
COPY . .
EXPOSE 3000

CMD ["node","index.js"]


