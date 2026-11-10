package com.jejushopbuddy;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ShopBuddyApplication {
    public static void main(String[] args) {
        SpringApplication.run(ShopBuddyApplication.class, args);
    }
}
