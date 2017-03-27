package com.example.mytask;

/**
 * Created by Константин on 22.03.2017.
 */

public class LoginItem {
    String nameftp, login, password;

    public LoginItem(String name, String login,String password) {
        this.nameftp = name;
        this.login = login;
        this.password=password;

    }

    public String getNameftp() {return nameftp;}
    public String getLogin() {return login;}
    public String getPassword() {return password;}
}

