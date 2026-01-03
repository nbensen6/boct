FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
COPY guide.html /usr/share/nginx/html/guide.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
