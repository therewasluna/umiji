## Authentication Method: Password

### Changing or Resetting Password

On the panel's server, as root, type:

```bash
umiji
```

Pick `Owner password`. It shows the owner's username and asks for a new password, or makes a strong one if you press Enter.

The installer adds the `umiji` command. If the server doesn't have it, run the installer again:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/therewasluna/umiji/main/install.sh)
```

### Emergency Password Authentication Enable

If you turned off the "Password" method and then lost access to the other methods, `Owner password` also turns password login back on. Set a new password with it, then sign in.
