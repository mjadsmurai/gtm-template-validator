# GTM Template validator
Sometimes, after publishing an update to your GTM tag template, it may not appear in the Community Template Gallery, or your entire template may have disappeared from the listing.

Template updates are automatic, which means these problems stem from errors in the template itself.

If your template has disappeared from the listing, it usually means that the `metadata.yaml` file is invalid.

If your latest update does not appear or changelog section has stopped appearing in in your template profile, there is something wrong with the `template.tpl` file.

Identifying the issue is not easy, as Google does not indicate what the problem is or provide tools to validate these files.

Importing your own tag into GTM helps detect basic errors, but not more complex ones. For example, if you fail to list the permissions your tag uses, Google automatically adds them when you import it, preventing you from identifying that type of error.

Although incomplete, this validator should give you a hint about where the problem lies. You can use it at: https://mjadsmurai.github.io/gtm-template-validator/
