## 认证方式: 密码

### 修改或重置密码

在面板所在的服务器上，以 root 身份输入：

```bash
umiji
```

选择 `Owner password`。它会显示所有者的用户名，并要求输入新密码；直接按 Enter 则会生成一个强密码。

`umiji` 命令由安装脚本添加。如果服务器上没有它，请重新运行安装脚本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/therewasluna/umiji/main/install.sh)
```

### 启用紧急密码认证

如果你已禁用“Password”认证方式，之后又无法通过其他认证方式登录，`Owner password` 也会重新启用密码登录。用它设置新密码，然后登录。
