package com.example.mytask;

/**
 * Created by Константин on 02.03.2017.
 */

public class ObjectItem {
    String name, timesum;

    public ObjectItem(String name, String timename) {
        this.name = name;
        this.timesum = timename;

    }

    public String getName() {return name;}
    public String getTimesum() {return timesum;}
}
