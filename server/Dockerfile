FROM node:20-bookworm-slim
WORKDIR /app

# Install build tools required for node-gyp
RUN apt-get update && apt-get install -y python3 python-is-python3 make g++ && rm -rf /var/lib/apt/lists/*

#install dependencies
COPY package.json ./

# 1. Install C/C++ (clangd), Go, and Java system dependencies
RUN apt-get update && apt-get install -y \
    clangd \
    g++ \
    golang \
    default-jdk \
    wget \
    tar \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Go Language Server (gopls) globally
RUN go install golang.org/x/tools/gopls@v0.16.2
ENV PATH=$PATH:/root/go/bin

# 3. Install Eclipse JDTLS (Java Language Server)
RUN mkdir -p /opt/jdtls && \
    wget https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz -O jdtls.tar.gz && \
    tar -zxvf jdtls.tar.gz -C /opt/jdtls && \
    rm jdtls.tar.gz && \
    mv /opt/jdtls/plugins/org.eclipse.equinox.launcher_*.jar /opt/jdtls/plugins/org.eclipse.equinox.launcher.jar
RUN npm install
RUN npm rebuild node-pty
#copying the server code
COPY . .
EXPOSE 3000

CMD ["node","index.js"]


