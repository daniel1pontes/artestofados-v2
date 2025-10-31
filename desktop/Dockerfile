# build
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# serve
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
# opcional: adicionar nginx.conf custom em /etc/nginx/conf.d
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
