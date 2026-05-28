FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV PORT=5173
EXPOSE 5173

CMD ["npm", "run", "serve"]
