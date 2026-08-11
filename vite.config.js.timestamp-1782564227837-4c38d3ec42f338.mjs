// vite.config.js
import { defineConfig } from "file:///H:/_soft/zisaku/Notidian/node_modules/vite/dist/node/index.js";
import { viteSingleFile } from "file:///H:/_soft/zisaku/Notidian/node_modules/vite-plugin-singlefile/dist/esm/index.js";
var vite_config_default = defineConfig(({ command }) => {
  return {
    base: command === "build" ? "./" : "/",
    plugins: [viteSingleFile()],
    build: {
      outDir: "dist",
      assetsDir: "assets",
      sourcemap: true,
      emptyOutDir: true
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJIOlxcXFxfc29mdFxcXFx6aXNha3VcXFxcTm90aWRpYW5cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkg6XFxcXF9zb2Z0XFxcXHppc2FrdVxcXFxOb3RpZGlhblxcXFx2aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vSDovX3NvZnQvemlzYWt1L05vdGlkaWFuL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgeyB2aXRlU2luZ2xlRmlsZSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXNpbmdsZWZpbGUnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgY29tbWFuZCB9KSA9PiB7XG4gIHJldHVybiB7XG4gICAgYmFzZTogY29tbWFuZCA9PT0gJ2J1aWxkJyA/ICcuLycgOiAnLycsXG4gICAgcGx1Z2luczogW3ZpdGVTaW5nbGVGaWxlKCldLFxuICAgIGJ1aWxkOiB7XG4gICAgICBvdXREaXI6ICdkaXN0JyxcbiAgICAgIGFzc2V0c0RpcjogJ2Fzc2V0cycsXG4gICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICBlbXB0eU91dERpcjogdHJ1ZVxuICAgIH1cbiAgfTtcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFrUSxTQUFTLG9CQUFvQjtBQUMvUixTQUFTLHNCQUFzQjtBQUUvQixJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLFFBQVEsTUFBTTtBQUMzQyxTQUFPO0FBQUEsSUFDTCxNQUFNLFlBQVksVUFBVSxPQUFPO0FBQUEsSUFDbkMsU0FBUyxDQUFDLGVBQWUsQ0FBQztBQUFBLElBQzFCLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxNQUNSLFdBQVc7QUFBQSxNQUNYLFdBQVc7QUFBQSxNQUNYLGFBQWE7QUFBQSxJQUNmO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
